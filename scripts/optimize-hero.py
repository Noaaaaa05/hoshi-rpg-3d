"""Generate the mobile display asset; keep the uploaded hero.glb unchanged.

Optional desktop tool: blender --background --python scripts/optimize-hero.py
No Blender installation or build is needed to play or publish the game.
Only static, untextured geometry is reduced. Rigged/morph models are rejected.
"""
import bpy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/models/hero.glb"
OUTPUT = ROOT / "assets/models/hero-mobile.glb"
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes or bpy.data.actions or any(o.type == "ARMATURE" for o in bpy.context.scene.objects):
    raise RuntimeError("This helper only reduces the inspected static hero. Preserve rigs/animations separately.")
if any(o.data.shape_keys for o in meshes):
    raise RuntimeError("Morph targets must not be decimated by this helper.")
original = sum(len(o.data.loop_triangles) or len(o.data.polygons) for o in meshes)
ratio = min(1, 15000 / max(1, original))
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Mobile triangle budget", "DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format="GLB", export_yup=True,
                          export_animations=False, export_normals=True,
                          export_materials="NONE", export_extras=False)
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != source_hash:
    raise RuntimeError("Source changed unexpectedly")
print(json.dumps({"source": str(SOURCE), "source_sha256": source_hash,
                  "original_triangles": original, "output": str(OUTPUT),
                  "output_bytes": OUTPUT.stat().st_size}))
