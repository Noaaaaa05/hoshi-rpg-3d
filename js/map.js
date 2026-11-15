import { LANDMARKS, pathDistance } from './world.js';
export function createMap(canvas, world) {
  const ctx=canvas.getContext('2d'), background=document.createElement('canvas');background.width=background.height=240;
  const bg=background.getContext('2d'),scale=.95,xy=(v)=>120+v*scale;
  bg.fillStyle='#1d3e3a';bg.fillRect(0,0,240,240);
  bg.strokeStyle='#82a48312';bg.lineWidth=1;
  for(let i=0;i<=240;i+=30){bg.beginPath();bg.moveTo(i,0);bg.lineTo(i,240);bg.moveTo(0,i);bg.lineTo(240,i);bg.stroke();}
  for(let x=-120;x<120;x+=2)for(let z=-120;z<120;z+=2)if(pathDistance(x,z)<3.3){bg.fillStyle='#afbb8a55';bg.fillRect(xy(x),xy(z),2,2);}
  for(const t of world.trees){bg.fillStyle='#739c7945';bg.beginPath();bg.arc(xy(t.x),xy(t.z),2.5*t.s,0,Math.PI*2);bg.fill();}
  return (motor, yaw, discovered)=> {
    ctx.clearRect(0,0,240,240);ctx.drawImage(background,0,0);
    for(const landmark of LANDMARKS){
      const found=discovered.has(landmark.id);ctx.strokeStyle=found?'#e6d39c':'#97baa477';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(xy(landmark.x),xy(landmark.z),found?7:5,0,Math.PI*2);ctx.stroke();
      if(found){ctx.fillStyle='#e6d39c';ctx.beginPath();ctx.arc(xy(landmark.x),xy(landmark.z),2,0,Math.PI*2);ctx.fill();}
    }
    ctx.save();ctx.translate(xy(motor.x),xy(motor.z));ctx.rotate(-yaw);
    ctx.fillStyle='#e5e0b233';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,28,-Math.PI/2-.5,-Math.PI/2+.5);ctx.closePath();ctx.fill();ctx.restore();
    ctx.save();ctx.translate(xy(motor.x),xy(motor.z));ctx.rotate(-motor.angle+Math.PI);
    ctx.fillStyle='#fff0bc';ctx.shadowColor='#ecd39a';ctx.shadowBlur=9;ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(5.5,6);ctx.lineTo(0,3);ctx.lineTo(-5.5,6);ctx.closePath();ctx.fill();ctx.restore();
  };
}
