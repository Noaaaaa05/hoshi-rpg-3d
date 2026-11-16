"""Private, deterministic sheet extraction. No network, ML downloads or API calls."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy import ndimage as ndi

VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parents[2]
CATEGORIES = {"character", "monster", "weapon", "armor", "magic", "building", "nature", "unknown"}
LABELS = {"character":"人物", "monster":"モンスター", "weapon":"武器", "armor":"防具", "magic":"魔法", "building":"建物", "nature":"自然", "unknown":"未分類"}
Image.MAX_IMAGE_PIXELS = 20_000_000

def sha(data):
    return hashlib.sha256(data).hexdigest()

def save_json(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    tmp.replace(path)

def write_review(out,catalog):
    for name in ["review.js","review.css"]:
        shutil.copyfile(ROOT/"tools/asset_pipeline"/name,out/name)
    template=(ROOT/"tools/asset_pipeline/review.html").read_text()
    embedded=json.dumps(catalog,ensure_ascii=False).replace("<","\\u003c").replace("&","\\u0026")
    (out/"index.html").write_text(template.replace("__CATALOG_JSON__",embedded),encoding="utf8")

def archive_images(file):
    """Validate every ZIP member first; never extract or execute attached documents."""
    with zipfile.ZipFile(file) as z:
        members = z.infolist()
        if len(members) > 300 or sum(f.file_size for f in members) > 200 * 1024**2:
            raise ValueError("ZIP exceeds member/uncompressed byte limit")
        seen = set()
        for f in members:
            name = f.filename
            p = PurePosixPath(name)
            if name in seen or p.is_absolute() or ".." in p.parts or "\\" in name or ":" in name or ((f.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError("Unsafe, duplicate or symlink ZIP member")
            seen.add(name)
            if f.file_size > 25 * 1024**2 or (f.file_size > 1024**2 and f.file_size / max(1, f.compress_size) > 500):
                raise ValueError("Oversized or suspiciously compressed member")
        images = []
        pixels = 0
        for f in members:
            if f.is_dir() or PurePosixPath(f.filename).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                continue
            data = z.read(f)
            try:
                with Image.open(io.BytesIO(data)) as image:
                    if image.width * image.height > 20_000_000:
                        raise ValueError("Image pixel limit")
                    pixels += image.width * image.height
                    if pixels > 100_000_000:
                        raise ValueError("Batch pixel limit")
                    image.load()
                    rgba = ImageOps.exif_transpose(image).convert("RGBA")
            except (OSError, Image.UnidentifiedImageError):
                rgba = None
            images.append((f.filename, data, rgba))
        if not images:
            raise ValueError("ZIP contains no supported images")
        return sorted(images, key=lambda item: item[0])

def background_mask(image, mode):
    array = np.asarray(image)
    rgb = array[:, :, :3].astype(np.int16)
    alpha = array[:, :, 3]
    if np.any(alpha < 250):
        return alpha > 16, "alpha"
    if mode == "preserve":
        return np.ones(alpha.shape, dtype=bool), mode
    if mode == "auto":
        border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
        light = np.median(np.max(border, axis=1))
        mode = "white" if light > 220 else "black" if light < 50 else "preserve"
    if mode == "preserve":
        return np.ones(alpha.shape, dtype=bool), mode
    if mode == "black":
        return np.max(rgb, axis=2) > 36, mode
    # Remove edge-connected near-white matte, preserving enclosed white armor/eyes.
    possible = np.min(rgb, axis=2) >= 237
    seed = np.zeros(possible.shape, bool)
    seed[[0, -1], :] = possible[[0, -1], :]
    seed[:, [0, -1]] = possible[:, [0, -1]]
    background = ndi.binary_propagation(seed, mask=possible)
    return ~background, "white"

def runs(values):
    edges = np.diff(np.r_[False, values, False].astype(np.int8))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))

def union_boxes(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]

def component_boxes(mask):
    labels, _ = ndi.label(mask, np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    boxes = []
    for label, slices in enumerate(ndi.find_objects(labels), 1):
        if slices is None or sizes[label] < 10:
            continue
        y, x = slices
        boxes.append([x.start, y.start, x.stop, y.stop, int(sizes[label]), [label]])
    # Join detached fragments to a nearby larger component, without treating
    # color/shape as a semantic classifier or discarding potential small objects.
    boxes.sort(key=lambda b: b[4], reverse=True)
    merged = []
    for box in boxes:
        best = None
        for i, main in enumerate(merged):
            dx = max(0, main[0] - box[2], box[0] - main[2])
            dy = max(0, main[1] - box[3], box[1] - main[3])
            overlap_x = min(main[2], box[2]) - max(main[0], box[0])
            overlap_y = min(main[3], box[3]) - max(main[1], box[1])
            if dx <= 3 and dy <= 6 and (overlap_x > 0 or overlap_y > 0) and box[4] < main[4] * .3:
                best = i
                break
        if best is None:
            merged.append(box)
        else:
            main = merged[best]
            merged[best] = union_boxes(main, box) + [main[4] + box[4], main[5]+box[5]]
    return [(b[:4],b[5],labels) for b in merged if b[4] >= 25 and b[2] - b[0] >= 3 and b[3] - b[1] >= 3]

def split_saddles(box,members,labels,spec):
    """Separate weak joins between neighboring objects; never claim semantics."""
    x1,y1,x2,y2=box
    height=y2-y1
    if not spec.get('splitSaddles') or x2-x1<height*spec.get('maxAspect',1.8):
        return [box]
    region=np.isin(labels[y1:y2,x1:x2],members)
    projection=region.sum(axis=0)
    minimum_width=max(12,round(height*.35))
    candidates=[]
    for start,end in runs(projection<=max(1,height*.10)):
        minimum=int(start+np.argmin(projection[start:end]))
        if minimum>=minimum_width and region.shape[1]-minimum>=minimum_width:
            candidates.append(minimum)
    cuts=[0]
    for candidate in candidates:
        if candidate-cuts[-1]>=minimum_width and int(region[:,cuts[-1]:candidate].sum())>=50:
            cuts.append(candidate)
    cuts.append(x2-x1)
    if len(cuts)<3:
        return [box]
    parts=[]
    for left,right in zip(cuts,cuts[1:]):
        yy,xx=np.where(region[:,left:right])
        if len(xx)>=25:
            parts.append([x1+left+int(xx.min()),y1+int(yy.min()),x1+left+int(xx.max())+1,y1+int(yy.max())+1])
    return parts or [box]

def detections(mask, spec):
    h, w = mask.shape
    if spec.get("method") == "grid":
        rows, cols = spec["rows"], spec["columns"]
        if not isinstance(rows, int) or not isinstance(cols, int) or not (1 <= rows <= min(100,h) and 1 <= cols <= min(100,w)):
            raise ValueError("Invalid grid")
        return [([round(c*w/cols), round(r*h/rows), round((c+1)*w/cols), round((r+1)*h/rows)], "grid", [r, c], None)
                for r in range(rows) for c in range(cols)]
    rows = spec.get("rows")
    if isinstance(rows, list):
        if not rows or any(type(v) is not int for v in rows) or rows[0] != 0 or rows[-1] != h or any(a >= b for a, b in zip(rows, rows[1:])):
            raise ValueError("Row hints must cover the actual source height")
        bands = list(zip(rows, rows[1:]))
    else:
        # Only split at genuinely empty horizontal gutters. Irregular sheets
        # remain connected-component detection, not a guessed regular grid.
        occupied = np.sum(mask, axis=1) >= 3
        bands = runs(ndi.binary_closing(occupied, iterations=1, border_value=1))
        if not bands:
            bands = [(0, h)]
    output = []
    if spec.get("rowColumns") and (len(spec["rowColumns"])!=len(bands) or any(type(n) is not int or n<1 or n>100 for n in spec["rowColumns"])):
        raise ValueError("Each row needs a valid reviewed column count")
    for row, (y1, y2) in enumerate(bands):
        if spec.get("rowColumns"):
            columns=spec["rowColumns"][row]
            projection=mask[y1:y2].sum(axis=0)
            boundaries=[0]
            for column in range(1,columns):
                expected=round(w*column/columns)
                left=max(boundaries[-1]+1,round(expected-w/columns*.18))
                right=min(w-1,round(expected+w/columns*.18))
                values=projection[left:right+1]
                minima=np.flatnonzero(values==values.min())+left
                boundaries.append(int(min(minima,key=lambda x:abs(x-expected))))
            boundaries.append(w)
            for column,(x1,x2) in enumerate(zip(boundaries,boundaries[1:])):
                output.append(([x1,y1,x2,y2],"adaptive-row-grid",[row,column],None))
            continue
        for column, (box,members,labels) in enumerate(sorted(component_boxes(mask[y1:y2]), key=lambda b:(b[0][0], b[0][1]))):
            parts=split_saddles(box,members,labels,spec)
            for part in parts:
                method='components+saddle-split' if len(parts)>1 else "components+row-hints" if isinstance(rows, list) else "components+gutters"
                output.append(([part[0],part[1]+y1,part[2],part[3]+y1],method,[row,column],(labels,members,int(y1),int(y2))))
    return output

def category_for(box, size, spec):
    x, y = (box[0]+box[2])/2/size[0], (box[1]+box[3])/2/size[1]
    for left, top, right, bottom, category in spec.get("regions", []):
        if left <= x < right and top <= y < bottom:
            return category, "layout-region", .65
    return spec.get("category", "unknown"), "source-label" if spec.get("category") else "unclassified", .55

def fingerprint(image):
    rgb = Image.new("RGB", image.size, "white")
    rgb.paste(image, mask=image.getchannel("A"))
    thumb = np.asarray(rgb.resize((9, 8)).convert("L"))
    bits = thumb[:, 1:] > thumb[:, :-1]
    value = sum(int(bit) << i for i, bit in enumerate(bits.ravel()))
    colors = np.asarray(rgb.resize((8, 8))).mean(axis=(0, 1)).tolist()
    return f"{value:016x}", colors

def mark_duplicates(assets):
    exact, prior = {}, []
    for asset in assets:
        if not asset.get("png"):
            continue
        target = exact.get(asset["png_sha256"])
        if target:
            asset["duplicate_of"] = target
            asset["flags"].append("duplicate_exact")
        else:
            exact[asset["png_sha256"]] = asset["id"]
            for other in prior:
                if ((int(asset["dhash"],16) ^ int(other["dhash"],16)).bit_count() <= 5 and
                    max(abs(a-b) for a,b in zip(asset["mean_rgb"], other["mean_rgb"])) < 12 and
                    .65 < asset["aspect"] / other["aspect"] < 1.5):
                    asset["possible_duplicate_of"] = other["id"]
                    asset["flags"].append("duplicate_possible")
                    break
            prior.append(asset)

def process_source(name, data, image, spec, out, corrections=None):
    source_sha = sha(data)
    source_id = "source-" + source_sha[:16]
    source_file = "sources/" + source_id + PurePosixPath(name).suffix.lower()
    (out / source_file).write_bytes(data)  # unchanged input, including watermark
    mask, mode = background_mask(image, spec.get("background", "auto"))
    boxes = detections(mask, spec)
    if len(boxes) > 3000:
        raise ValueError("Too many candidate objects in a source; supply reviewed grid/row hints")
    coverage = np.zeros(mask.shape, bool)
    assets = []
    overlay = image.convert("RGB")
    draw = ImageDraw.Draw(overlay)
    for number, (detected, method, cell, selection) in enumerate(boxes, 1):
        detected = list(map(int,detected))
        asset_id = "asset-" + sha((source_sha+json.dumps(detected)+method).encode())[:20]
        correction = (corrections or {}).get(asset_id, {})
        x1, y1, x2, y2 = map(int, detected)
        occupancy = float(mask[y1:y2, x1:x2].mean())
        flags = ["rights_unknown", "classification_review"]
        if method=='components+saddle-split':
            flags.append('split_contact_review')
        if spec.get("watermark") or "watermark" in name.lower():
            flags.append("watermark_present")
        if mode == "preserve":
            flags.append("background_preserved")
        if occupancy < .005:
            flags.append("empty_cell")
        box = [max(0,x1-2), max(0,y1-2), min(image.width,x2+2), min(image.height,y2+2)]
        if method in ["grid","adaptive-row-grid"]:
            box = [x1, y1, x2, y2]
            edge = mask[y1:y2,x1:x2]
            if edge[0].mean()>.05 or edge[-1].mean()>.05 or edge[:,0].mean()>.05 or edge[:,-1].mean()>.05:
                flags.append("touches_cell_edge")
        if "bbox" in correction:
            candidate = correction["bbox"]
            if (not isinstance(candidate,list) or len(candidate)!=4 or any(type(v) is not int for v in candidate) or
                not (0<=candidate[0]<candidate[2]<=image.width and 0<=candidate[1]<candidate[3]<=image.height)):
                raise ValueError("Invalid corrected crop coordinates")
            box = candidate
            flags.append("manual_crop_review")
        if x1 <= 1 or y1 <= 1 or x2 >= image.width-1 or y2 >= image.height-1:
            flags.append("touches_source_edge")
        width, height = box[2]-box[0], box[3]-box[1]
        if max(width,height)<96 or min(width,height)<24 or width*height<3500:
            flags.append("low_resolution")
        if width > image.width*.25 or height > image.height*.3:
            flags.append("merged_or_scene_review")
        category, basis, confidence = category_for(box, image.size, spec)
        if "category" in correction:
            category, basis, confidence = correction["category"], "review-correction", .9
        if category not in CATEGORIES:
            raise ValueError("Invalid category")
        if category in {'character','monster','armor','building'} and width/height>2.2:
            flags.append('wide_object_review')
        crop = image.crop(box)
        if selection and len(selection[1])>1:
            flags.append('fragment_join_review')
        if mode == "black":
            a = np.asarray(crop).copy()
            a[:,:,3] = np.max(a[:,:,:3], axis=2)
            crop = Image.fromarray(a)
            flags.append("glow_alpha_review")
        elif mode != "preserve":
            a = np.asarray(crop).copy()
            selected_mask=mask[box[1]:box[3],box[0]:box[2]].copy()
            if selection and "bbox" not in correction:
                labels,members,top,bottom=selection
                selected_mask[:]=False
                start,end=max(top,box[1]),min(bottom,box[3])
                selected_mask[start-box[1]:end-box[1]]=np.isin(labels[start-top:end-top,box[0]:box[2]],members)
                if method=='components+saddle-split':
                    selected_mask[:,:max(0,x1-box[0])]=False
                    selected_mask[:,x2-box[0]:]=False
            a[:,:,3] = np.minimum(a[:,:,3], selected_mask.astype(np.uint8)*255)
            crop = Image.fromarray(a)
        support=np.asarray(crop.getchannel('A'))>36
        cores,number_of_cores=ndi.label(ndi.binary_erosion(support,iterations=3),np.ones((3,3)))
        if number_of_cores:
            core_sizes=np.bincount(cores.ravel())[1:]
            if sum(core_sizes>=max(80,float(support.sum())*.12))>1:
                flags.append('multi_lobe_review')
        png = f"crops/{asset_id}.png"
        crop.save(out/png)
        thumb = crop.copy()
        thumb.thumbnail((128,128))
        thumb.save(out/f"thumbs/{asset_id}.webp",quality=85)
        dhash, mean = fingerprint(crop)
        if selection and "bbox" not in correction:
            labels,members,top,bottom=selection
            start,end=max(top,box[1]),min(bottom,box[3])
            coverage[start:end,box[0]:box[2]] |= np.isin(labels[start-top:end-top,box[0]:box[2]],members)
        else:
            coverage[box[1]:box[3],box[0]:box[2]] = True
        draw.rectangle((box[0],box[1],box[2]-1,box[3]-1), outline="#e74343" if any(f in flags for f in ["low_resolution","watermark_present"]) else "#11845b", width=1)
        draw.text((box[0]+2,box[1]+2),str(number),fill="#df1538",stroke_width=1,stroke_fill="white")
        assets.append({"id":asset_id,"name":str(correction.get("name") or f"{LABELS[category]} {PurePosixPath(name).stem[:2]}-{number:03d}")[:120],"category":category,
            "classification":{"basis":basis,"confidence":confidence,"verified":False},
            "source_id":source_id,"source_image":name,"source_sha256":source_sha,
            "bbox":box,"detected_bbox":detected,"coordinate_space":"exif-transposed-display-pixels; xyxy; right/bottom exclusive",
            "method":method,"cell":cell,"width":width,"height":height,"foreground_ratio":round(occupancy,4),
            "png":png,"thumbnail":f"thumbs/{asset_id}.webp","png_sha256":sha((out/png).read_bytes()),
            "dhash":dhash,"mean_rgb":mean,"aspect":width/height,"flags":flags,
            "quality":"failed" if "empty_cell" in flags else "needs_review",
            "rights":{"status":"blocked" if "watermark_present" in flags else "unknown","evidence":None},
            "production":{"status":"quarantined","route":"2d-particle-or-sprite" if category=="magic" else "3d-review"}})
    foreground = int(mask.sum())
    uncovered = int((mask & ~coverage).sum())
    overlay.thumbnail((1536,1024))
    overlay_file = f"overlays/{source_id}.jpg"
    overlay.save(out/overlay_file,quality=85)
    return {"id":source_id,"name":name,"sha256":source_sha,"width":image.width,"height":image.height,
        "original":source_file,"preview":source_file,"overlay":overlay_file,"background":mode,
        "count":len(assets),"foreground_pixels":foreground,"uncovered_foreground_pixels":uncovered,
        "coverage":round(1-uncovered/max(1,foreground),5),"missing_detection_review":uncovered>max(25,foreground*.01),
        "rights_status":"blocked" if spec.get("watermark") else "unknown","watermark":bool(spec.get("watermark")),
        "watermark_check":"visual+filename" if spec.get("watermark") else "no watermark observed in supplied preview; not a license determination"},assets

def extract(input_file, output, profile=None, force=False, corrections=None):
    output = Path(output).resolve()
    # Review results must never enter GitHub Pages' public asset tree.
    if output == ROOT or ROOT/"assets" == output or ROOT/"assets" in output.parents:
        raise ValueError("Use a private output directory outside public assets")
    profile = profile or {"version":1,"sources":{}}
    if Path(input_file).stat().st_size > 64*1024**2:
        raise ValueError("ZIP compressed byte limit")
    correction_assets = (corrections or {}).get("assets",{})
    key = sha(Path(input_file).read_bytes()+json.dumps([profile,correction_assets],sort_keys=True).encode()+Path(__file__).read_bytes())
    if output.exists() and (output/"catalog.json").exists() and not force:
        existing = json.loads((output/"catalog.json").read_text())
        if existing.get("fingerprint") != key:
            raise ValueError("Output belongs to a different input/profile; choose another output directory")
        expected_marker=key+"\n"+sha((output/"catalog.json").read_bytes())
        intact=(output/".hoshi-private-batch").is_file() and (output/".hoshi-private-batch").read_text()==expected_marker
        intact= intact and all((output/name).is_file() for name in ['index.html','review.js','review.css','quality.json'])
        intact= intact and all((output/s["original"]).is_file() and sha((output/s["original"]).read_bytes())==s["sha256"] and (output/s["overlay"]).is_file() for s in existing["sources"] if s.get("status")!='decode_failed')
        if intact and all((output/a["png"]).is_file() and sha((output/a["png"]).read_bytes())==a["png_sha256"] and (output/a["thumbnail"]).is_file() for a in existing["assets"]):
            write_review(output,existing)
            return existing, True
    if output.exists() and not (output/".hoshi-private-batch").is_file():
        raise ValueError("Refusing to replace an unmanaged output directory")
    output.parent.mkdir(parents=True,exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".hoshi-assets-",dir=output.parent))
    try:
        for directory in ["sources","crops","thumbs","overlays"]:
            (staging/directory).mkdir()
        sources, assets, seen_sources = [], [], {}
        for name, data, image in archive_images(input_file):
            digest = sha(data)
            if digest in seen_sources:
                seen_sources[digest].setdefault("duplicate_files",[]).append(name)
                continue
            if image is None:
                sources.append({"id":"source-"+digest[:16],"name":name,"sha256":digest,"count":0,"status":"decode_failed","coverage":0,"missing_detection_review":True,"rights_status":"unknown"})
                continue
            spec = profile.get("sources",{}).get(PurePosixPath(name).name,{})
            source, extracted = process_source(name,data,image,spec,staging,correction_assets)
            seen_sources[digest] = source
            sources.append(source)
            assets.extend(extracted)
        if len({a["id"] for a in assets}) != len(assets):
            raise ValueError("Repeated source content: duplicate IDs; remove duplicated sheets")
        mark_duplicates(assets)
        summary = {"sources":len(sources),"failed_sources":sum(s.get('status')=='decode_failed' for s in sources),"duplicate_sources":sum(len(s.get('duplicate_files',[])) for s in sources),"assets":len(assets),"categories":{c:sum(a["category"]==c for a in assets) for c in sorted(CATEGORIES)},
            "flags":{flag:sum(flag in a["flags"] for a in assets) for flag in sorted({f for a in assets for f in a["flags"]})},
            "public_ready":0,"api_requests":0,"charged_credits":0}
        catalog = {"version":1,"pipeline_version":VERSION,"fingerprint":key,"private":True,
            "classification_note":"Layout/source labels are provisional, not neural recognition or proven identities. Check mixed-category crops.",
            "summary":summary,"sources":sources,"assets":assets}
        save_json(staging/"catalog.json",catalog)
        save_json(staging/"quality.json",{"summary":summary,"sources":sources,"failures":[{"id":a["id"],"flags":a["flags"]} for a in assets if a["quality"]=="failed"]})
        write_review(staging,catalog)
        (staging/".hoshi-private-batch").write_text(key+"\n"+sha((staging/"catalog.json").read_bytes()))
        if output.exists():
            # Keep paid results and human ledgers. Their old hashes/fingerprints
            # still need re-review; extraction must never erase them on rerun.
            generated={"sources","crops","thumbs","overlays","catalog.json","quality.json","index.html","review.js","review.css",".hoshi-private-batch"}
            for child in output.iterdir():
                if child.name in generated:
                    continue
                if child.is_symlink():
                    raise ValueError("Refusing to follow a symlink in the private output")
                if child.is_dir():
                    shutil.copytree(child,staging/child.name,symlinks=True)
                else:
                    shutil.copyfile(child,staging/child.name)
            backup=Path(tempfile.mkdtemp(prefix=".hoshi-previous-",dir=output.parent));backup.rmdir()
            output.replace(backup)
            try:
                staging.replace(output)
            except BaseException:
                backup.replace(output)
                raise
            else:
                shutil.rmtree(backup)
        else:
            staging.replace(output)
        return catalog, False
    finally:
        if staging.exists():
            shutil.rmtree(staging)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input",type=Path)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--profile",type=Path)
    parser.add_argument("--force",action="store_true")
    parser.add_argument("--corrections",type=Path)
    args = parser.parse_args()
    catalog,cached = extract(args.input,args.output,json.loads(args.profile.read_text()) if args.profile else None,args.force,json.loads(args.corrections.read_text()) if args.corrections else None)
    print(json.dumps({"cached":cached,**catalog["summary"]},ensure_ascii=False,indent=2))

if __name__ == "__main__":
    main()
