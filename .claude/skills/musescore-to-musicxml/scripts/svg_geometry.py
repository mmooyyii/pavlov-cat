"""MuseScore SVG 页面 -> 每个元素类别的子路径包围盒 (JSON)。

用法: python3.13 svg_geometry.py page_00.svg geo_00.json
MuseScore 导出的 SVG 把同类元素合并成一个 <path class="Note"> ... 每个 M 起始的子路径
就是一个图元 (符头/延音线/符杠/变音记号...)。输出 {class: [[x0,y0,x1,y1], ...]}。
注意: 空心符头 (二分/全音符) 是 2 个子路径, 升号 # 是 2 个子路径, 重升 x 是 1 个;
按中心距离 <0.6 倍线距合并即可。y 坐标配合 StaffLines 可直接换算成音级 (半线距一级)。
"""
import re, json, sys
NUM=re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
def parse_path(d):
    """return list of subpaths, each a list of (x,y) points (endpoints+control pts)"""
    toks=re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|'+NUM.pattern, d)
    i=0; subs=[]; cur=None; x=y=0.0; sx=sy=0.0; cmd=None
    def num():
        nonlocal i; v=float(toks[i]); i+=1; return v
    while i<len(toks):
        t=toks[i]
        if re.match(r'[A-Za-z]',t): cmd=t; i+=1
        # implicit repeat keeps cmd
        if cmd in 'Mm':
            nx,ny=num(),num()
            if cmd=='m': nx+=x; ny+=y
            x,y=nx,ny; sx,sy=x,y; cur=[(x,y)]; subs.append(cur); cmd='L' if cmd=='M' else 'l'
        elif cmd in 'Ll':
            nx,ny=num(),num()
            if cmd=='l': nx+=x; ny+=y
            x,y=nx,ny; cur.append((x,y))
        elif cmd=='H': x=num(); cur.append((x,y))
        elif cmd=='h': x+=num(); cur.append((x,y))
        elif cmd=='V': y=num(); cur.append((x,y))
        elif cmd=='v': y+=num(); cur.append((x,y))
        elif cmd in 'Cc':
            pts=[num() for _ in range(6)]
            if cmd=='c': pts=[pts[k]+(x if k%2==0 else y) for k in range(6)]
            cur+= [(pts[0],pts[1]),(pts[2],pts[3])]; x,y=pts[4],pts[5]; cur.append((x,y))
        elif cmd in 'SsQq':
            pts=[num() for _ in range(4)]
            if cmd in 'sq': pts=[pts[k]+(x if k%2==0 else y) for k in range(4)]
            cur.append((pts[0],pts[1])); x,y=pts[2],pts[3]; cur.append((x,y))
        elif cmd in 'Tt':
            pts=[num() for _ in range(2)]
            if cmd=='t': pts=[pts[0]+x,pts[1]+y]
            x,y=pts; cur.append((x,y))
        elif cmd in 'Aa':
            pts=[num() for _ in range(7)]
            nx,ny=pts[5],pts[6]
            if cmd=='a': nx+=x; ny+=y
            x,y=nx,ny; cur.append((x,y))
        elif cmd in 'Zz':
            x,y=sx,sy; cmd=None
        else:
            raise ValueError(f"bad token {t} at {i}")
    return subs
def bbox(pts):
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    return [min(xs),min(ys),max(xs),max(ys)]
def load(svgfile):
    s=open(svgfile).read()
    out={}
    for m in re.finditer(r'<path([^>]*?)/>', s, re.S):
        attrs=m.group(1)
        cm=re.search(r'class="([^"]*)"',attrs)
        dm=re.search(r'\sd="([^"]*)"',attrs)
        if not cm or not dm: continue
        cls=cm.group(1)
        subs=parse_path(dm.group(1))
        out.setdefault(cls,[]).extend(bbox(p) for p in subs)
    # staff lines: y of each line
    return out
if __name__=="__main__":
    f=sys.argv[1]
    out=load(f)
    for k,v in out.items(): print(k,len(v))
    json.dump(out,open(sys.argv[2],'w'))
