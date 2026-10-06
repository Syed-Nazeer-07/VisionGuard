import re

# 1. Update Analyze.tsx
with open('apps/web/src/pages/Analyze.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

if 'controlsList="nofullscreen"' not in content:
    content = content.replace(
        'controls\n                playsInline',
        'controls\n                controlsList="nofullscreen"\n                playsInline'
    )
    with open('apps/web/src/pages/Analyze.tsx', 'w', encoding='utf-8') as f:
        f.write(content)

# 2. Update VideoReview.tsx
with open('apps/web/src/pages/VideoReview.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

if 'controlsList="nofullscreen"' not in content:
    content = content.replace(
        'controls\n                      crossOrigin="anonymous"',
        'controls\n                      controlsList="nofullscreen"\n                      crossOrigin="anonymous"'
    )
    with open('apps/web/src/pages/VideoReview.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
