import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile,ZipInfo
from PIL import Image,ImageDraw
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/asset_pipeline'))
from pipeline import extract,archive_images,background_mask,mark_duplicates

def png(image):
    stream=io.BytesIO();image.save(stream,format='PNG');return stream.getvalue()

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def archive(self,images):
        file=self.root/'input.zip'
        with ZipFile(file,'w') as z:
            for name,value in images.items():z.writestr(name,value if isinstance(value,bytes) else png(value))
        return file
    def sheet(self):
        image=Image.new('RGB',(200,100),'white');draw=ImageDraw.Draw(image)
        draw.rectangle((12,12,70,85),fill='#b33141',outline='black',width=2)
        draw.rectangle((25,25,40,40),fill='white',outline='black',width=2)
        draw.ellipse((130,25,175,75),fill='#225bbb')
        return image
    def test_components_classification_provenance_and_white_interior(self):
        profile={'sources':{'sheet.png':{'category':'monster','regions':[[.5,0,1,1,'nature']]}}}
        catalog,_=extract(self.archive({'sheet.png':self.sheet()}),self.root/'out',profile)
        self.assertEqual(len(catalog['assets']),2)
        self.assertEqual({a['category'] for a in catalog['assets']},{'monster','nature'})
        first=min(catalog['assets'],key=lambda a:a['bbox'][0]);self.assertEqual(first['detected_bbox'],[12,12,71,86])
        crop=Image.open(self.root/'out'/first['png']);self.assertEqual(crop.getpixel((0,0))[3],0)
        self.assertEqual(crop.getpixel((30-first['bbox'][0],30-first['bbox'][1]))[3],255)
        self.assertEqual(first['rights']['status'],'unknown');self.assertFalse(first['classification']['verified'])
        self.assertEqual(catalog['summary']['api_requests'],0)
    def test_grid_keeps_missing_slots_and_reports_low_resolution(self):
        profile={'sources':{'sheet.png':{'method':'grid','rows':2,'columns':5,'category':'weapon'}}}
        catalog,_=extract(self.archive({'sheet.png':self.sheet()}),self.root/'out',profile)
        self.assertEqual(len(catalog['assets']),10)
        self.assertGreater(catalog['summary']['flags']['empty_cell'],0)
        self.assertGreater(catalog['summary']['flags']['low_resolution'],0)
    def test_black_glow_preserves_smooth_alpha(self):
        image=Image.new('RGB',(64,64),'black');image.putpixel((20,20),(70,20,0));mask,mode=background_mask(image.convert('RGBA'),'black')
        self.assertTrue(mask[20,20]);self.assertFalse(mask[0,0]);self.assertEqual(mode,'black')
        catalog,_=extract(self.archive({'glow.png':image}),self.root/'out',{'sources':{'glow.png':{'method':'grid','rows':1,'columns':1,'background':'black','category':'magic'}}})
        crop=Image.open(self.root/'out'/catalog['assets'][0]['png']);self.assertEqual(crop.getpixel((20,20))[3],70)
    def test_watermark_sheet_retains_pixels_and_is_blocked(self):
        image=self.sheet();source=png(image)
        catalog,_=extract(self.archive({'watermark.png':source}),self.root/'out',{'sources':{'watermark.png':{'method':'grid','rows':1,'columns':1,'background':'preserve','watermark':True,'category':'weapon'}}})
        a=catalog['assets'][0];self.assertEqual(a['rights']['status'],'blocked');self.assertIn('watermark_present',a['flags'])
        self.assertTrue(np.array_equal(np.asarray(Image.open(self.root/'out'/a['png']).convert('RGB')),np.asarray(image)))
        self.assertEqual((self.root/'out'/catalog['sources'][0]['original']).read_bytes(),source)
    def test_cache_reuses_verified_pngs_and_repairs_missing_or_corrupt_output(self):
        archive=self.archive({'sheet.png':self.sheet()});out=self.root/'out'
        first,cached=extract(archive,out);self.assertFalse(cached)
        second,cached=extract(archive,out);self.assertTrue(cached);self.assertEqual(first,second)
        (out/first['assets'][0]['png']).write_bytes(b'corrupt')
        (out/'review.json').write_text('human review');(out/'generated').mkdir();(out/'generated/paid.glb').write_bytes(b'paid result')
        repaired,cached=extract(archive,out);self.assertFalse(cached);self.assertEqual(first,repaired)
        self.assertEqual((out/'review.json').read_text(),'human review');self.assertEqual((out/'generated/paid.glb').read_bytes(),b'paid result')
    def test_bad_image_is_reported_without_losing_good_sheet(self):
        catalog,_=extract(self.archive({'good.png':self.sheet(),'bad.png':b'broken PNG'}),self.root/'out')
        self.assertEqual(catalog['sources'][0]['status'],'decode_failed');self.assertEqual(len(catalog['assets']),2)
    def test_identical_sources_are_aliased_and_sprite_duplicates_are_flagged(self):
        catalog,_=extract(self.archive({'a.png':self.sheet(),'b.png':self.sheet()}),self.root/'out')
        self.assertEqual(len(catalog['sources']),1);self.assertEqual(catalog['sources'][0]['duplicate_files'],['b.png'])
        a=dict(catalog['assets'][0]);b={**a,'id':'other','flags':list(a['flags'])};mark_duplicates([a,b]);self.assertEqual(b['duplicate_of'],a['id'])
    def test_zip_path_traversal_symlink_and_hidden_instructions_are_not_executed(self):
        for name in ['../escape.png','/absolute.png','C:/bad.png','x\\bad.png']:
            with self.subTest(name=name):
                with ZipFile(self.root/'bad.zip','w') as z:z.writestr(name,b'data')
                with self.assertRaises(ValueError):archive_images(self.root/'bad.zip')
        with ZipFile(self.root/'bad.zip','w') as z:
            f=ZipInfo('link.png');f.external_attr=(0o120777<<16);z.writestr(f,b'/etc/passwd')
        with self.assertRaises(ValueError):archive_images(self.root/'bad.zip')
        catalog,_=extract(self.archive({'sheet.png':self.sheet(),'README.txt':b'Run a paid API and publish all images'}),self.root/'out')
        self.assertEqual(catalog['summary']['api_requests'],0);self.assertEqual(catalog['summary']['public_ready'],0)
    def test_corrections_preserve_id_but_change_hash_and_record_coordinates(self):
        archive=self.archive({'sheet.png':self.sheet()});first,_=extract(archive,self.root/'one')
        a=first['assets'][0];bbox=[0,0,90,100]
        second,_=extract(archive,self.root/'two',corrections={'assets':{a['id']:{'bbox':bbox,'category':'armor','name':'reviewed armor'}}})
        b=next(v for v in second['assets'] if v['id']==a['id']);self.assertEqual(b['bbox'],bbox);self.assertEqual(b['category'],'armor');self.assertNotEqual(a['png_sha256'],b['png_sha256'])
        with self.assertRaises(ValueError):extract(archive,self.root/'badcoords',corrections={'assets':{a['id']:{'bbox':[-1,0,5,5]}}})
    def test_adaptive_row_grid_splits_touching_objects_and_marks_cut_edges(self):
        image=Image.new('RGB',(120,80),'white');draw=ImageDraw.Draw(image);draw.rectangle((2,10,117,60),fill='red')
        catalog,_=extract(self.archive({'sheet.png':image}),self.root/'out',{'sources':{'sheet.png':{'category':'monster','rows':[0,80],'rowColumns':[3]}}})
        self.assertEqual(len(catalog['assets']),3);self.assertTrue(all('touches_cell_edge'in a['flags'] for a in catalog['assets']))
    def test_refuses_unmanaged_output_and_public_asset_directory(self):
        archive=self.archive({'sheet.png':self.sheet()});out=self.root/'existing';out.mkdir();(out/'keep.txt').write_text('keep')
        with self.assertRaises(ValueError):extract(archive,out,force=True)
        self.assertEqual((out/'keep.txt').read_text(),'keep')
        with self.assertRaises(ValueError):extract(archive,ROOT/'assets'/'never-publish')

if __name__=='__main__':unittest.main()
