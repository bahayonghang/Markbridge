import json
from pathlib import Path

def rgb(value):
    return tuple(int(value[i:i+2], 16) for i in (1, 3, 5))

def mix(front, back, alpha):
    return tuple(alpha*a+(1-alpha)*b for a,b in zip(front,back))

def luminance(color):
    channels=[c/255 for c in color]
    channels=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in channels]
    return sum(c*w for c,w in zip(channels,(.2126,.7152,.0722)))

def ratio(a,b):
    x,y=sorted((luminance(a),luminance(b)))
    return (y+.05)/(x+.05)

palettes={
"light":{"field":["#E7F6F1","#EDE7F8"],"paper":"#FFFFFF","alpha":.78,"solid":"#FFFFFF","ink":"#24303A","muted":"#5C6B76","input":"#187A56","input_wash":"#E7F7F0","output":"#6D4BD6","output_wash":"#F3EEFC","control":"#73828C","danger":"#A93232","caution":"#80570F","primary":"#187A56","on_primary":"#FFFFFF"},
"dark":{"field":["#162820","#262238"],"paper":"#1E262B","alpha":.90,"solid":"#1E262B","ink":"#EAF0F3","muted":"#B5C1C9","input":"#86D9B4","input_wash":"#203C32","output":"#C6B3FF","output_wash":"#342C49","control":"#91A3AF","danger":"#FFABA3","caution":"#E8C47D","primary":"#86D9B4","on_primary":"#162820"}
}
rows=[]
for theme,p in palettes.items():
    backs={"solid":rgb(p["solid"]),"input_wash":rgb(p["input_wash"]),"output_wash":rgb(p["output_wash"])}
    for alpha in [p["alpha"],.96]:
        for i,field in enumerate(p["field"]):
            backs[f"paper_{alpha}_end{i}"]=mix(rgb(p["paper"]),rgb(field),alpha)
    for name,back in backs.items():
        for role in ["ink","muted","input","output","danger","caution","control"]:
            minimum=3 if role=="control" else 4.5
            value=ratio(rgb(p[role]),back)
            rows.append({"theme":theme,"foreground":role,"background":name,"ratio":round(value,4),"minimum":minimum,"pass":value>=minimum})
    value=ratio(rgb(p["on_primary"]),rgb(p["primary"]))
    rows.append({"theme":theme,"foreground":"on_primary","background":"primary","ratio":round(value,4),"minimum":4.5,"pass":value>=4.5})
result={"kind":"candidate_static_palette_only","runtime_verified":False,"pairs":rows,"failures":[r for r in rows if not r["pass"]]}
Path(__file__).with_name("palette-preflight.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"pairs":len(rows),"failures":result["failures"]}))
