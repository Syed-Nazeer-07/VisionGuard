import re

with open('apps/web/src/pages/Analyze.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# We need to replace the wrapper we just added.
old_wrapper = r'<div className=\{`relative flex items-center justify-center h-full w-full \$\{showVideo \? \'\' : \'hidden\'\}`\}>'
new_wrapper = r'<div className={`relative inline-flex items-center justify-center max-w-full max-h-full ${showVideo ? \'\' : \'hidden\'}`}>'

content = re.sub(old_wrapper, new_wrapper, content)

with open('apps/web/src/pages/Analyze.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
