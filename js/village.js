import * as THREE from 'three';
import { heightAt } from './physics.js';

// Lightweight playable village prototype. Uses no paid services or external assets.
export function createVillage(scene, grid) {
  const root=new THREE.Group();scene.add(root);
  const mat=c=>new THREE.MeshStandardMaterial({color:c,roughness:1,flatShading:true});
  const wall=mat('#e6d4ad'),roof=mat('#547b8a'),wood=mat('#775a49'),skin=mat('#e8b991'),cloth=mat('#517aab'),gold=mat('#e9c47d');
  const mesh=(g,m,x,y,z,parent=root)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);parent.add(o);return o;};
  // Put the market beside the existing campsite landmark, keeping the main path clear.
  const spots=[[-33,31],[-39,36],[-47,36]];
  // Exact box footprint collisions and terrain-following corner supports.
  for(const [x,z] of spots) {
    const y=heightAt(x,z);
    mesh(new THREE.BoxGeometry(5.1,.22,4.1),wood,x,y+.08,z);
    for (const dx of [-2.25,2.25]) for (const dz of [-1.75,1.75]) {
      const ground=heightAt(x+dx,z+dz);
      const bottom=Math.min(y-.12,ground-.12);
      const top=y+.18;
      mesh(new THREE.BoxGeometry(.42,top-bottom,.42),wood,x+dx,(top+bottom)/2,z+dz);
    }
    mesh(new THREE.BoxGeometry(5,3.1,4),wall,x,y+1.55,z);
    grid.add({x,z,radius:3.3,shape:'box',halfX:2.5,halfZ:2,height:5.5});
    const r=mesh(new THREE.ConeGeometry(4.25,2.25,4),roof,x,y+4.2,z);r.rotation.y=Math.PI/4;
    mesh(new THREE.BoxGeometry(1.2,1.8,.13),wood,x,y+.9,z-2.08);
  }
  const stalls=[{x:-30,z:24},{x:-35,z:23}];
  for(const {x,z} of stalls) {
    const y=heightAt(x,z);
    mesh(new THREE.BoxGeometry(2.7,1.55,1.3),wood,x,y+.42,z);
    grid.add({x,z,radius:1.55,shape:'box',halfX:1.35,halfZ:.65,height:3.1});
    for(const dx of [-1.15,1.15])mesh(new THREE.CylinderGeometry(.09,.09,2.5,6),wood,x+dx,y+1.75,z);
    const awning=mesh(new THREE.BoxGeometry(3.1,.18,1.8),roof,x,y+2.9,z);awning.rotation.z=.06;
    for(let i=0;i<3;i++)mesh(new THREE.IcosahedronGeometry(.24,0),gold,x-.7+i*.7,y+1.3,z);
  }
  const npcDefs=[
    {id:'merchant',name:'商人ルカ',x:-30,z:26,lines:['いらっしゃい！ 星灯りの街へようこそ。','薬草ならいつでも用意しているよ。'],shop:true},
    {id:'guard',name:'衛兵セナ',x:-39,z:29,lines:['森の奥には魔物がいる。気をつけて。']},
    {id:'villager',name:'村人ミオ',x:-45,z:31,lines:['ここは旅人が休む小さな集落だよ。']}
  ];
  const npcs=npcDefs.map((data,i)=>{
    const g=new THREE.Group();g.position.set(data.x,heightAt(data.x,data.z),data.z);root.add(g);
    mesh(new THREE.CylinderGeometry(.35,.4,1.05,7),cloth,0,.82,0,g);
    mesh(new THREE.SphereGeometry(.3,10,8),skin,0,1.63,0,g);
    mesh(new THREE.ConeGeometry(.37,.33,7),i===1?wood:roof,0,1.99,0,g);
    for(const dx of [-.2,.2])mesh(new THREE.BoxGeometry(.16,.65,.19),wood,dx,.15,0,g);
    grid.add({x:data.x,z:data.z,radius:.42,height:2.1});
    return {...data,group:g};
  });
  const inventory={herbs:0,gold:100};
  let open=false;
  const panel=document.createElement('div');
  panel.id='village-dialog';
  panel.style.cssText='position:fixed;z-index:40;left:50%;bottom:21%;transform:translateX(-50%);width:min(90vw,470px);padding:16px;background:#102b35ed;border:2px solid #d7bd79;border-radius:15px;color:white;font:16px system-ui;display:none;text-align:center;box-shadow:0 8px 30px #0008';
  panel.innerHTML='<strong id="village-name"></strong><p id="village-line"></p><p id="village-wallet"></p><button id="village-buy" type="button">薬草を買う（20G）</button> <button id="village-close" type="button">閉じる</button>';
  document.body.append(panel);
  const interact=document.createElement('button');interact.type='button';interact.textContent='話す';interact.setAttribute('aria-label','近くの村人と話す');
  interact.style.cssText='position:fixed;z-index:35;right:16px;top:46%;padding:13px 18px;border:2px solid #d7bd79;border-radius:24px;background:#163e4d;color:white;font:bold 15px system-ui;display:none';
  document.body.append(interact);
  const name=panel.querySelector('#village-name'),line=panel.querySelector('#village-line'),wallet=panel.querySelector('#village-wallet'),buy=panel.querySelector('#village-buy');
  const buttonStyle='padding:10px;border-radius:9px;border:0;background:#d7bd79;color:#17303a;font-weight:bold';
  buy.style.cssText=buttonStyle;panel.querySelector('#village-close').style.cssText=buttonStyle;
  let nearest=null;
  function close(){open=false;panel.style.display='none';}
  function talk(){
    if(!nearest)return;
    open=true;panel.style.display='block';name.textContent=nearest.name;line.textContent=nearest.lines[0];
    buy.style.display=nearest.shop?'inline-block':'none';wallet.textContent=nearest.shop?`所持金: ${inventory.gold}G / 薬草: ${inventory.herbs}個`:'';
  }
  interact.addEventListener('click',talk);
  panel.querySelector('#village-close').addEventListener('click',close);
  buy.addEventListener('click',()=>{
    if(inventory.gold<20){line.textContent='お金が足りないようだね。';return;}
    inventory.gold-=20;inventory.herbs++;line.textContent='薬草を1個購入した！';
    wallet.textContent=`所持金: ${inventory.gold}G / 薬草: ${inventory.herbs}個`;
  });
  const onKey=e=>{if(e.code==='KeyE'&&!e.repeat){if(open)close();else if(nearest)talk();}};
  window.addEventListener('keydown',onKey);
  return {
    update(dt,playerX,playerZ,active,time){
      nearest=null;let distance=3.6;
      if(active)for(const npc of npcs){const d=Math.hypot(playerX-npc.x,playerZ-npc.z);if(d<distance){nearest=npc;distance=d;}}
      interact.style.display=nearest&&!open?'block':'none';
      if((!nearest||!active)&&open)close();
      for(let i=0;i<npcs.length;i++)npcs[i].group.rotation.y=Math.sin(time*.65+i)*.18;
    },
    getInventory:()=>({...inventory}),
    dispose(){window.removeEventListener('keydown',onKey);panel.remove();interact.remove();scene.remove(root);}
  };
}
