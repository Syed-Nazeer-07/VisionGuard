import re

with open('apps/web/src/pages/Analyze.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_block = """      const classCounts = msg.boxes.reduce((acc, b) => {
        acc[b.className] = (acc[b.className] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const classDist = Object.entries(classCounts).map(([c, n]) => `${c}: ${n}`).join(', ');

      analysisLogger.log({
        ...logFor(session),
        category: 'DETECTION',
        message: `Objects: ${msg.boxes.length} | ${classDist || 'none'}`
      });"""

new_block = """      const classCounts = msg.boxes.reduce((acc, b) => {
        acc[b.className] = (acc[b.className] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const classDist = Object.entries(classCounts).map(([c, n]) => `${c}: ${n}`).join(', ');

      let minConf = 1;
      let sumConf = 0;
      let smallObjects = 0;
      msg.boxes.forEach(b => {
        if (b.prob < minConf) minConf = b.prob;
        sumConf += b.prob;
        if (b.w * b.h < 0.05) smallObjects++; // rough proxy for small bounding boxes relative to 640x640 tensor
      });
      const avgConf = msg.boxes.length ? (sumConf / msg.boxes.length) : 0;
      minConf = msg.boxes.length ? minConf : 0;

      analysisLogger.log({
        ...logFor(session),
        category: 'DETECTION',
        message: `Objects: ${msg.boxes.length} (${smallObjects} small) | Conf: Avg ${(avgConf * 100).toFixed(0)}%, Min ${(minConf * 100).toFixed(0)}% | ${classDist || 'none'}`
      });"""

content = content.replace(old_block, new_block)

with open('apps/web/src/pages/Analyze.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
