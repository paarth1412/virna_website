// Illustrated product art — placeholders until real photography arrives.
// A product with an `image` URL shows the photo instead (see productVisual in app.js).

export const TONES = { sand:'#ECE2D0', sage:'#DEE0CE', blush:'#F0DDD4', stone:'#E4E0D7', oat:'#F2EADB' };
export const TONE_ALT = { sand:'stone', sage:'oat', blush:'sand', stone:'sage', oat:'blush' };
const C = { brown:'#5B3E2B', brown2:'#7A5238', bamboo:'#C8A67B', mari:'#D38B3A', mari2:'#E4AC5A', mari3:'#B8732C',
  rose:'#B45F52', leaf:'#6F7A4E', clay:'#B06A43', clayD:'#8C4F30', kraft:'#CFB58F', kraftD:'#B89A70',
  flame:'#E8B04F', flame2:'#F6DC98', cream:'#F6EFE2', ember:'#C9683F', smoke:'rgba(47,43,37,.22)' };

export function rng(seed){ let s=0; for(const ch of seed) s=(s*31+ch.charCodeAt(0))>>>0; return ()=>((s=(s*1664525+1013904223)>>>0)/4294967296); }
const shadow=(cx,cy,rx)=>`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx*.11}" fill="rgba(47,43,37,.08)"/>`;
const smoke=(x,y)=>`<path d="M${x} ${y} c-12 -18 12 -30 0 -46 s12 -28 -2 -46" stroke="${C.smoke}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
const flame=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 C-12 -20 -4 -42 6 -58 C14 -38 20 -18 8 0 Z" fill="${C.flame}"/><path d="M2 -4 C-4 -16 0 -28 5 -36 C10 -26 12 -14 6 -4 Z" fill="${C.flame2}"/></g>`;
const marigold=(x,y,r)=>{ let p=''; for(let i=0;i<10;i++){const a=i/10*Math.PI*2; p+=`<circle cx="${(x+Math.cos(a)*r*.72).toFixed(1)}" cy="${(y+Math.sin(a)*r*.72).toFixed(1)}" r="${(r*.36).toFixed(1)}" fill="${C.mari2}"/>`;}
  return p+`<circle cx="${x}" cy="${y}" r="${r*.68}" fill="${C.mari}"/><circle cx="${x}" cy="${y}" r="${r*.3}" fill="${C.mari3}"/>`; };
const leafShape=(x,y,rot,len=24,col=C.leaf)=>`<ellipse cx="${x}" cy="${y}" rx="${len*.34}" ry="${len}" fill="${col}" transform="rotate(${rot} ${x} ${y})"/>`;

function diyaG(x,y,s){
  let dots=''; for(let i=-3;i<=3;i++) dots+=`<circle cx="${i*22}" cy="${34-Math.abs(i)*3}" r="3.5" fill="${C.cream}" opacity=".85"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M88 -4 Q125 -16 136 -30 Q132 4 96 12 Z" fill="${C.clay}"/>
    <path d="M-100 0 C-82 78 82 78 100 0 Z" fill="${C.clay}"/>
    <ellipse cx="0" cy="0" rx="100" ry="13" fill="${C.clayD}"/>
    <ellipse cx="0" cy="0" rx="84" ry="8" fill="#7C4428"/>
    ${dots}<path d="M-70 20 q17 10 35 0 t35 0 t35 0 t35 0" stroke="${C.cream}" stroke-width="2.5" fill="none" opacity=".7"/>
    ${flame(130,-28,1)}</g>`;
}
function agarbattiG(accent){
  const sticks=[[190,305,160,125],[200,305,202,110],[210,305,245,130]];
  let s=''; for(const [bx,by,tx,ty] of sticks){ const mx=bx+(tx-bx)*.38, my=by+(ty-by)*.38;
    s+=`<line x1="${bx}" y1="${by}" x2="${mx}" y2="${my}" stroke="${C.bamboo}" stroke-width="3" stroke-linecap="round"/>
        <line x1="${mx}" y1="${my}" x2="${tx}" y2="${ty}" stroke="${C.brown}" stroke-width="7" stroke-linecap="round"/>
        <circle cx="${tx}" cy="${ty}" r="3.5" fill="${C.ember}"/>${smoke(tx,ty-4)}`; }
  return shadow(200,322,120)+s+`<path d="M92 312 Q200 284 308 312 Q200 336 92 312Z" fill="${accent}"/><path d="M130 312 Q200 300 270 312" stroke="${C.cream}" stroke-width="1.5" fill="none" opacity=".5"/>`;
}
const ART = {
  agarbatti:p=>agarbattiG(p.accent||C.clay),
  dhoop:p=>{ const cone=p.cone||C.brown; let c='';
    for(const [x,y,h] of [[150,296,62],[250,296,66],[200,300,88]]) c+=`<path d="M${x-27} ${y} Q${x} ${y+7} ${x+27} ${y} L${x} ${y-h} Z" fill="${cone}"/><path d="M${x} ${y-h} L${x+27} ${y} Q${x+14} ${y+4} ${x+6} ${y+4}Z" fill="rgba(0,0,0,.12)"/>`;
    return shadow(200,326,118)+`<ellipse cx="200" cy="304" rx="104" ry="22" fill="${p.accent||C.clay}"/><ellipse cx="200" cy="300" rx="90" ry="14" fill="rgba(255,255,255,.16)"/>`+c+`<circle cx="200" cy="212" r="4" fill="${C.ember}"/>`+smoke(200,206); },
  sambrani:()=>{ const cup=(x,y,w)=>`<path d="M${x-w} ${y-62} L${x+w} ${y-62} L${x+w*.74} ${y} Q${x} ${y+9} ${x-w*.74} ${y} Z" fill="${C.brown2}"/><ellipse cx="${x}" cy="${y-62}" rx="${w}" ry="${w*.24}" fill="${C.brown}"/><ellipse cx="${x}" cy="${y-62}" rx="${w*.55}" ry="${w*.11}" fill="${C.ember}" opacity=".85"/>`+smoke(x,y-68);
    return shadow(200,326,125)+`<ellipse cx="200" cy="316" rx="118" ry="16" fill="#B9B4AA"/>`+cup(150,306,40)+cup(248,312,46); },
  toran:()=>{ const P0=[20,96],P1=[200,196],P2=[380,96]; const q=t=>[(1-t)**2*P0[0]+2*(1-t)*t*P1[0]+t*t*P2[0],(1-t)**2*P0[1]+2*(1-t)*t*P1[1]+t*t*P2[1]];
    let s=`<path d="M${P0} Q${P1} ${P2}" stroke="#8C6A4A" stroke-width="2" fill="none"/>`;
    for(let i=0;i<=10;i++){ const [x,y]=q(.04+i*.092);
      if(i%2===0){ const drop=i%4===0?120:84; s+=`<line x1="${x}" y1="${y}" x2="${x}" y2="${y+drop}" stroke="#8C6A4A" stroke-width="1.5"/>`;
        for(let k=1;k<=Math.floor(drop/34);k++) s+=marigold(x,y+k*32,11);
        s+=leafShape(x,y+drop+18,0,20); }
      else s+=leafShape(x,y+26,i%3?12:-12,26); }
    for(let i=0;i<=10;i++){ const [x,y]=q(.04+i*.092); s+=marigold(x,y,17); }
    return s; },
  petals:p=>{ const r=rng(p.slug||'petals'), cols=p.palette||[C.rose]; let s='';
    const petal=(x,y)=>{const col=cols[Math.floor(r()*cols.length)]; return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="10" ry="6" fill="${col}" transform="rotate(${Math.floor(r()*180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;};
    for(let i=0;i<16;i++) s+=petal(165+r()*70,140+r()*38);
    let floor=''; for(let i=0;i<18;i++) floor+=petal(80+r()*240,306+r()*36);
    return shadow(200,330,130)+floor+s+`<path d="M150 175 L250 175 L268 320 L132 320 Z" fill="${C.kraft}"/><path d="M150 175 L250 175 L253 197 L147 197Z" fill="${C.kraftD}"/><rect x="170" y="232" width="60" height="44" rx="3" fill="${C.cream}"/><path d="M200 266 v-22 M200 256 l-8 -6 M200 252 l7 -5" stroke="${C.leaf}" stroke-width="2" fill="none" stroke-linecap="round"/>`; },
  diya:()=>shadow(200,322,130)+diyaG(185,268,1.05),
  diyaset:()=>shadow(200,330,150)+diyaG(122,250,.55)+diyaG(262,244,.55)+diyaG(182,292,.78),
  tealight:()=>{ const t=(x,y)=>`<rect x="${x-36}" y="${y-10}" width="72" height="40" rx="6" fill="#B9B4AA"/><rect x="${x-36}" y="${y-10}" width="72" height="40" rx="6" fill="url(#tin)"/><ellipse cx="${x}" cy="${y-10}" rx="36" ry="10" fill="#A7A197"/><ellipse cx="${x}" cy="${y-10}" rx="31" ry="7.5" fill="${C.cream}"/><line x1="${x}" y1="${y-11}" x2="${x}" y2="${y-20}" stroke="#2F2B25" stroke-width="2"/>`+flame(x-3,y-19,.62);
    return `<defs><linearGradient id="tin" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient></defs>`+shadow(200,330,130)+t(140,280)+t(260,280)+t(200,306); },
  giftbox:p=>{ const box=p.box||C.kraft, rib=p.ribbon||C.clay;
    let dots=''; for(let i=0;i<6;i++) dots+=leafShape(138+i*26,262+(i%2)*18,i%2?30:-30,8,'rgba(255,255,255,.28)');
    return shadow(200,322,120)+`<rect x="115" y="196" width="170" height="122" fill="${box}"/>${dots}<rect x="103" y="170" width="194" height="34" rx="3" fill="${box}"/><rect x="103" y="198" width="194" height="6" fill="rgba(0,0,0,.08)"/><rect x="191" y="170" width="18" height="148" fill="${rib}"/><path d="M200 172 C168 128 132 150 162 172 Z" fill="${rib}"/><path d="M200 172 C232 128 268 150 238 172 Z" fill="${rib}"/><path d="M200 172 C188 190 176 206 170 214 M200 172 C212 190 222 204 228 212" stroke="${rib}" stroke-width="6" fill="none"/><circle cx="200" cy="171" r="9" fill="${rib}"/><circle cx="200" cy="171" r="9" fill="rgba(0,0,0,.12)"/><line x1="236" y1="200" x2="256" y2="226" stroke="#8C6A4A" stroke-width="1.5"/><g transform="rotate(14 262 238)"><rect x="244" y="226" width="40" height="26" rx="2" fill="${C.cream}"/><circle cx="251" cy="239" r="2.5" fill="#8C6A4A"/></g>`; },
  hamper:()=>{ let s=''; for(const [bx,tx,ty] of [[170,150,110],[182,176,98],[194,204,116]]) s+=`<line x1="${bx}" y1="220" x2="${tx}" y2="${ty}" stroke="${C.brown}" stroke-width="6" stroke-linecap="round"/><circle cx="${tx}" cy="${ty}" r="3" fill="${C.ember}"/>`;
    return shadow(200,326,130)+s+smoke(176,94)+diyaG(128,200,.36)+marigold(248,200,18)+marigold(276,212,15)+marigold(226,214,14)+leafShape(292,190,40,20)
      +`<path d="M95 216 L305 216 L290 320 L110 320 Z" fill="${C.kraft}"/><path d="M88 204 L312 204 L308 224 L92 224Z" fill="${C.kraftD}"/><rect x="158" y="252" width="84" height="34" rx="2" fill="${C.cream}"/><text x="200" y="275" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="20" font-weight="600" fill="#2F2B25">virna</text>`; },
  pack:p=>{ const words=p.name.split(' '), lines=[]; let cur='';
    for(const w of words){ if((cur+' '+w).trim().length>13){ lines.push(cur.trim()); cur=w; } else cur+=' '+w; } lines.push(cur.trim());
    const tx=lines.slice(0,3).map((l,i)=>`<text x="200" y="${238+i*24}" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="22" font-weight="600" fill="#2F2B25">${l}</text>`).join('');
    return shadow(200,326,110)+`<path d="M120 130 L280 130 L280 320 L120 320 Z" fill="${C.kraft}"/><path d="M120 130 L150 112 L310 112 L280 130 Z" fill="#DCC6A2"/><path d="M280 130 L310 112 L310 300 L280 320 Z" fill="${C.kraftD}"/><rect x="138" y="176" width="124" height="126" rx="2" fill="${C.cream}"/><text x="200" y="204" text-anchor="middle" font-family="Mulish, sans-serif" font-size="10" letter-spacing="3" fill="#A8643F">VIRNA</text><line x1="170" y1="214" x2="230" y2="214" stroke="#DDD3C2"/>${tx}`; }
};
export function art(p, type){ return `<svg viewBox="0 0 400 400" aria-hidden="true">${ART[type||p.art](p)}</svg>`; }
export function heroArt(){
  let petals=''; const r=rng('hero'); for(let i=0;i<22;i++){const x=70+r()*340,y=500+r()*40,c=[C.rose,C.mari,C.mari2][i%3]; petals+=`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="10" ry="6" fill="${c}" transform="rotate(${Math.floor(r()*180)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;}
  let g=''; const P0=[92,150],P1=[240,250],P2=[388,150];
  for(let i=0;i<=8;i++){ const t=.05+i*.1125, x=(1-t)**2*P0[0]+2*(1-t)*t*P1[0]+t*t*P2[0], y=(1-t)**2*P0[1]+2*(1-t)*t*P1[1]+t*t*P2[1]; g+=(i%2?leafShape(x,y+24,0,20):'')+marigold(x,y,15); }
  return `<svg viewBox="0 0 480 560" role="img" aria-label="A lit clay diya, incense sticks and a marigold garland">
    <path d="M40 560 L40 240 A200 200 0 0 1 440 240 L440 560Z" fill="#E6DCC8"/>
    <path d="M92 150 Q240 250 388 150" stroke="#8C6A4A" stroke-width="2" fill="none"/>${g}
    <g transform="translate(215 130) scale(.7)">${agarbattiG('#6F7A4E')}</g>
    ${shadow(210,532,170)}${diyaG(170,466,1.05)}${petals}
  </svg>`;
}
