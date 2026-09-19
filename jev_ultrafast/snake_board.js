(() => {
  // Read the actual default Google Snake canvas. Never infer hidden game state.
  const canvas = [...document.querySelectorAll('canvas')].find(c => c.width > 400 && c.height > 400);
  if (!canvas) throw Error('Snake board is not visible. Use the default classic board.');
  const {width: w, height: h} = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  const green = ([r,g,b]) => (r===170 && g===215 && b===81) || (r===162 && g===209 && b===73);
  const blue = ([r,g,b]) => b > 150 && b > r * 1.5 && b > g * 1.25;
  const red = ([r,g,b]) => r > 180 && g < 130 && b < 100;
  let x0=w, y0=h, x1=0, y1=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(green(at(x,y))) {
    x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
  }
  if(x1<=x0 || y1<=y0) throw Error('Unsupported Snake colors or board is obscured. Reset to classic mode.');
  // The classic board is 17 by 15; reject alternative board sizes/themes.
  const size=(x1-x0+1)/17;
  if(size<10 || Math.abs((y1-y0+1)/15-size)>1) throw Error('Unsupported Snake board dimensions.');
  // Verify tile transitions rather than silently reading another board size.
  const first=at(x0+2,y0+2).join(',');
  let transition=x0+2;
  while(transition<=x1 && at(transition,y0+2).join(',')===first) transition++;
  if(Math.abs(transition-x0-size)>2) throw Error('Use the standard 17 × 15 Snake board.');
  const counts = Array.from({length:255},()=>({blue:0,red:0}));
  const eyes=[];
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
    const p=at(x,y), col=Math.min(16,Math.floor((x-x0)/size)), row=Math.min(14,Math.floor((y-y0)/size));
    const cell=counts[row*17+col];
    if(blue(p)) cell.blue++;
    if(red(p)) cell.red++;
    // White eye pixels must neighbor the blue snake, excluding the keyboard overlay.
    if(p.every(v=>v>235) && [[-4,0],[4,0],[0,-4],[0,4]].some(([dx,dy])=>
      x+dx>=0 && y+dy>=0 && x+dx<w && y+dy<h && blue(at(x+dx,y+dy)))) eyes.push([x,y]);
  }
  // Rounded caps and motion interpolation spill blue pixels into neighboring
  // cells. Occupancy uses cell centers, not any blue edge pixel.
  const body=counts.flatMap((c,i)=>blue(at(Math.floor(x0+(i%17+.5)*size),
    Math.floor(y0+(Math.floor(i/17)+.5)*size))) ? [[i%17,Math.floor(i/17)]] : []);
  const apples=counts.flatMap((c,i)=>c.red>size*size*.10 ? [[i%17,Math.floor(i/17)]] : []);
  const eye=eyes.length ? eyes.reduce((a,p)=>[a[0]+p[0]/eyes.length,a[1]+p[1]/eyes.length],[0,0]) : null;
  const text=document.body.innerText;
  return {width:17,height:15,body,apples,eye,origin:[x0,y0],cell_size:size,
    canvas_width:w,canvas_height:h,image:canvas.toDataURL('image/png').split(',')[1],
    score:Number(text.match(/^\s*(\d+)/)?.[1] || 0),
    game_over:/Play again|Try again/i.test(text),text:text.slice(0,500)};
})()
