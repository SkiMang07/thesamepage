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

# --- 6. template essentials — every top-level template file, not just page.html.
#     (Originally checked page.html alone; generalised when about.html/contact.html
#     were added as their own templates instead of composing through page.html.)
tpl_dir=os.path.join(T,"templates")
for tf_name in sorted(os.listdir(tpl_dir)):
    tp=os.path.join(tpl_dir,tf_name)
    if not (os.path.isfile(tp) and tf_name.endswith(".html")): continue
    tpl=io.open(tp,encoding="utf-8").read()
    # Blog templates are templateType: blog and carry no dnd_area — a blog
    # listing and a blog post both take their content from the blog's own
    # records, so there is nothing to drag into either one. Everything else
    # (the annotation, both standard includes, resolvable partials) still
    # applies to them.
    is_blog = "templateType: blog" in tpl
    needles=[("standard_header_includes","missing standard_header_includes"),
             ("standard_footer_includes","missing standard_footer_includes")]
    if not is_blog:
        needles=[("templateType: page","missing templateType annotation")]+needles+[
                 ("dnd_area","missing dnd_area")]
    for needle,msg in needles:
        if needle not in tpl: bad("%s: %s"%(tf_name,msg))
    for inc in re.findall(r'include "([^"]+)"', tpl):
        p=os.path.normpath(os.path.join(tpl_dir,inc))
        if not os.path.exists(p): bad("%s: include does not resolve: %s"%(tf_name,inc))
    for p in re.findall(r'dnd_module path="\.\./modules/([a-z\-]+)"', tpl):
        if not os.path.isdir(os.path.join(md,p+".module")):
            bad("%s: dnd_module path missing: %s"%(tf_name,p))

# --- 7. blog featured-image contract. The publisher attaches one native image;
#     these three render points make it visible without duplicating it in post_body.
blog_post=io.open(os.path.join(tpl_dir,"blog-post.html"),encoding="utf-8").read()
blog_index=io.open(os.path.join(tpl_dir,"blog-index.html"),encoding="utf-8").read()
blog_image_contract = [
    (blog_post, 'class="fg-featured"', "blog-post.html: missing featured post image"),
    (blog_post, "content.featured_image_alt_text|escape_attr", "blog-post.html: missing featured image alt text"),
    (blog_post, 'class="fg-card-image"', "blog-post.html: missing related-card image"),
    (blog_post, "p.featured_image_alt_text|escape_attr", "blog-post.html: missing related-card image alt text"),
    (blog_index, 'class="fg-card-image"', "blog-index.html: missing listing-card image"),
    (blog_index, "content.featured_image_alt_text|escape_attr", "blog-index.html: missing listing-card image alt text"),
    (css, ".fg-card-image", "main.css: missing card image treatment"),
    (css, ".fg-featured img", "main.css: missing post image treatment"),
    (css, "aspect-ratio:16/9", "main.css: missing shared 16:9 image crop"),
]
for haystack,needle,msg in blog_image_contract:
    if needle not in haystack: bad(msg)

if fail:
    print("FAIL (%d)"%len(fail))
    for f in fail: print("  -",f)
    sys.exit(1)
print("theme OK")
