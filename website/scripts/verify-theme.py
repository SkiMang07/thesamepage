#!/usr/bin/env python3
"""Pre-upload checks for the HubSpot theme.

Run from website/:   python3 scripts/verify-theme.py

Every check here exists because it once broke a real upload, or shipped
something broken that uploaded cleanly. Add to it, do not trim it.
"""
import os, io, json, re, sys

T = "theme"
RESERVED = {"label","body","name","id","type","class","style","content"}
fail = []

def bad(msg): fail.append(msg)

# --- 0. no empty files. An empty partial uploads happily and renders nothing.
for r,_,fs in os.walk(T):
    for f in fs:
        p=os.path.join(r,f)
        if os.path.getsize(p)==0: bad("empty file: "+p)

# --- 1. all JSON parses
for r,_,fs in os.walk(T):
    for f in fs:
        if f.endswith(".json"):
            try: json.load(io.open(os.path.join(r,f),encoding="utf-8"))
            except Exception as e: bad("bad JSON %s: %s"%(os.path.join(r,f),e))

# --- 2. theme fields: colours only, no reserved names
tf=json.load(io.open(os.path.join(T,"fields.json"),encoding="utf-8"))
theme_paths=set()
for g in tf:
    if g.get("type")=="group":
        for c in g["children"]:
            theme_paths.add(g["name"]+"."+c["name"])
            if c["type"]!="color": bad("theme field not a colour: %s.%s"%(g["name"],c["name"]))
            if c["name"] in RESERVED: bad("reserved theme field name: "+c["name"])

# --- 3. every theme.x.y reference resolves
for r,_,fs in os.walk(T):
    for f in fs:
        if f.endswith((".html",".css")):
            t=io.open(os.path.join(r,f),encoding="utf-8").read()
            for ref in re.findall(r"theme\.([a-z_0-9]+\.[a-z_0-9]+)", t):
                if ref.rsplit(".color",1)[0] not in theme_paths:
                    bad("dangling theme ref %s in %s"%(ref,f))

# --- 4. modules: field refs, reserved names, occurrence defaults
md=os.path.join(T,"modules")
for d in sorted(os.listdir(md)):
    fields=json.load(io.open(os.path.join(md,d,"fields.json"),encoding="utf-8"))
    html=io.open(os.path.join(md,d,"module.html"),encoding="utf-8").read()
    have=set()
    def walk(fl):
        for f in fl:
            have.add(f["name"])
            if f["name"] in RESERVED: bad("reserved field name %s in %s"%(f["name"],d))
            if f["type"]=="group":
                occ=f.get("occurrence",{})
                if "default" not in occ: bad("%s: %s missing occurrence.default"%(d,f["name"]))
                elif occ["default"] < occ.get("min",1):
                    bad("%s: %s occurrence.default < min"%(d,f["name"]))
                walk(f["children"])
    walk(fields)
    for ref in set(re.findall(r"module\.([a-z_0-9]+)", html)):
        if ref not in have: bad("%s: module.%s has no field"%(d,ref))

# --- 5. no literal colour below the token block
css=io.open(os.path.join(T,"css","main.css"),encoding="utf-8").read()
after=css.split("--sans:",1)[-1].split("\n",1)[-1]
for h in sorted(set(re.findall(r"#[0-9A-Fa-f]{3,8}\b", after))):
    bad("literal colour outside the token block: "+h)

# --- 6. template essentials
tpl=io.open(os.path.join(T,"templates","page.html"),encoding="utf-8").read()
for needle,msg in [("templateType: page","missing templateType annotation"),
                   ("standard_header_includes","missing standard_header_includes"),
                   ("standard_footer_includes","missing standard_footer_includes"),
                   ("dnd_area","missing dnd_area")]:
    if needle not in tpl: bad(msg)
for inc in re.findall(r'include "([^"]+)"', tpl):
    p=os.path.normpath(os.path.join(T,"templates",inc))
    if not os.path.exists(p): bad("include does not resolve: "+inc)
for p in re.findall(r'dnd_module path="\.\./modules/([a-z\-]+)"', tpl):
    if not os.path.isdir(os.path.join(md,p+".module")): bad("dnd_module path missing: "+p)

if fail:
    print("FAIL (%d)"%len(fail))
    for f in fail: print("  -",f)
    sys.exit(1)
print("theme OK")
