"""Our own colored vector-like shapes; never a copy of uploaded user sheets."""
import argparse
import io
import json
from pathlib import Path
import sys
import tempfile
from zipfile import ZipFile
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/asset_pipeline'))
from pipeline import extract

def make_fixture(output):
    image=Image.new('RGB',(960,480),'white')
    draw=ImageDraw.Draw(image)
    for row in range(6):
        for col in range(12):
            x,y=col*80+12,row*80+12
            color=((col*31+40)%200,(row*37+50)%200,(col*9+row*21+20)%200)
            draw.ellipse((x,y,x+48,y+48),fill=color,outline='black',width=3)
            draw.rectangle((x+15,y+12,x+25,y+25),fill='white',outline='black')
    with tempfile.TemporaryDirectory() as directory:
        archive=Path(directory)/'synthetic.zip'
        buf=io.BytesIO();image.save(buf,format='PNG')
        with ZipFile(archive,'w') as z:z.writestr('synthetic.png',buf.getvalue())
        profile={'version':1,'sources':{'synthetic.png':{'method':'grid','rows':6,'columns':12,'category':'monster','regions':[[0,0,1,.5,'character'],[0,.5,1,1,'monster']]}}}
        return extract(archive,output,profile,force=True)[0]

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    result=make_fixture(Path(args.output));print(json.dumps(result['summary']))
