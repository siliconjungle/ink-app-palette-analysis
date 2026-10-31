-- Minimal GrafX2 raster host for the original DBToolbox scripts.
-- Native Lua pixel storage keeps all chart computation off the UI thread.
unpack = table.unpack
math.atan2 = function(y,x) return math.atan(y,x) end
math.pow = function(x,y) return x^y end
local floor,min,max,sqrt,abs = math.floor,math.min,math.max,math.sqrt,math.abs
local W,H,P = 640,432,{}
local PAL = INPUT_PALETTE
local NC = #PAL
for i=NC+1,256 do PAL[i] = PAL[1] end
local function clamp(v) return max(0,min(255,v)) end
function dofile() end -- all three exact dependencies are loaded by the runner
function getcolor(i)
  local c=PAL[max(0,min(255,floor(i or 0)))+1]
  return c[1],c[2],c[3]
end
getbackupcolor=getcolor
getsparecolor=getcolor
function getbackcolor() return BACKGROUND_INDEX or 0 end
function getforecolor() return 1 end
function getpicturesize() return W,H end
function setpicturesize(w,h) W,H=floor(w),floor(h);P={} end
function clearpicture(c) for i=1,W*H do P[i]=floor(c)%256 end end
function getpicturepixel(x,y)
  x,y=floor(x),floor(y)
  if x<0 or y<0 or x>=W or y>=H then return 0 end
  return P[y*W+x+1] or 0
end
getbackuppixel=getpicturepixel
function putpicturepixel(x,y,c)
  x,y=floor(x),floor(y)
  if x>=0 and y>=0 and x<W and y<H then P[y*W+x+1]=floor(c)%256 end
end
function drawfilledrect(x1,y1,x2,y2,c)
  x1,x2=max(0,floor(min(x1,x2))),min(W-1,floor(max(x1,x2)))
  y1,y2=max(0,floor(min(y1,y2))),min(H-1,floor(max(y1,y2)))
  c=floor(c)%256
  for y=y1,y2 do local o=y*W+1;for x=x1,x2 do P[o+x]=c end end
end
function drawline(x1,y1,x2,y2,c)
  x1,y1,x2,y2=floor(x1),floor(y1),floor(x2),floor(y2)
  local dx,dy=abs(x2-x1),-abs(y2-y1)
  local sx,sy=x1<x2 and 1 or -1,y1<y2 and 1 or -1
  local err=dx+dy
  while true do
    putpicturepixel(x1,y1,c)
    if x1==x2 and y1==y2 then break end
    local e=2*err
    if e>=dy then err=err+dy;x1=x1+sx end
    if e<=dx then err=err+dx;y1=y1+sy end
  end
end
function drawrect(x1,y1,x2,y2,c)
 drawline(x1,y1,x2,y1,c);drawline(x2,y1,x2,y2,c)
 drawline(x2,y2,x1,y2,c);drawline(x1,y2,x1,y1,c)
end
function matchcolor(r,g,b)
  r,g,b=floor(clamp(r)),floor(clamp(g)),floor(clamp(b))
  local best,index=math.huge,0
  for i=1,NC do
    local c=PAL[i];local dr,dg,db=c[1]-r,c[2]-g,c[3]-b
    local distance=dr*dr+dg*dg+db*db
    if distance<best then best,index=distance,i-1 end
  end
  return index
end
function matchcolor2(r,g,b,weight)
  r,g,b=clamp(r),clamp(g),clamp(b);weight=weight or .25
  local target=sqrt(.0676*r*r+.3025*g*g+.0361*b*b)
  local best,index=math.huge,0
  for i=1,NC do
    local c=PAL[i];local dr,dg,db=c[1]-r,c[2]-g,c[3]-b
    local cd=sqrt(.0676*dr*dr+.3025*dg*dg+.0361*db*db)
    if cd<1 then return i-1 end
    local brightness=sqrt(.0676*c[1]*c[1]+.3025*c[2]*c[2]+.0361*c[3]*c[3])
    local distance=weight*(abs(target-brightness)-cd)+cd
    if distance<best then best,index=distance,i-1 end
  end
  return index
end
local updates=0
function updatescreen() updates=updates+1;progress(updates) end
function waitbreak() return false end
function statusmessage() end
function messagebox(...) REPORT_MESSAGE=table.concat({...},'\n') end
function inputbox()
  return true,OPTIONS.excludeBackground and 1 or 0,OPTIONS.closeLow,OPTIONS.closeHigh,
    OPTIONS.saturations[1],OPTIONS.saturations[2],OPTIONS.saturations[3],
    OPTIONS.saturation=='purity' and 1 or 0,
    OPTIONS.saturation=='hsv' and 1 or 0,
    OPTIONS.saturation=='hsl' and 1 or 0
end
function EXPORT_PIXELS()
  local rows={}
  for y=0,H-1 do
    local row={};for x=0,W-1 do row[x+1]=P[y*W+x+1] or 0 end
    rows[y+1]=table.concat(row,',')
  end
  return {width=W,height=H,rows=rows,message=REPORT_MESSAGE or ''}
end
