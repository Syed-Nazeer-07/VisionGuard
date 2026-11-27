import { jsPDF } from 'jspdf';
import autoTable, { type UserOptions } from 'jspdf-autotable';
import { summarizeActivity, type AnalysisRecord } from './activityLedger';
import { analysisSource, breakdown, incidentRows, sessionCounts, vehicleRows } from './reportData';

type Format = 'executive' | 'detailed';
const fontName = 'DejaVuSans';
const pageWidth = 210;
const left = 15;
const contentWidth = pageWidth - left * 2;
const bodyBottom = 275;

async function loadReportFont() {
  const response = await fetch(new URL('../assets/DejaVuSans-report.ttf', import.meta.url));
  if (!response.ok) throw new Error('The report font is unavailable');
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The report font could not be read'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

export async function createReportPdf(
  records: readonly AnalysisRecord[], type: Format, scope: string, generatedAt = new Date(),
  font = loadReportFont,
) {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS('report.ttf', await font());
  doc.addFont('report.ttf', fontName, 'normal');
  doc.setFont(fontName, 'normal');
  const heading = type === 'executive' ? 'Executive summary' : 'Detailed analysis';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const totals = summarizeActivity(records);
  const formatted = new Intl.NumberFormat('en');
  let y = 56;

  const text = (value: string, size: number, color: [number, number, number], x = left) => {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(value, x, y);
  };
  const ensure = (height: number) => {
    if (y + height <= bodyBottom) return;
    doc.addPage();
    y = 28;
  };
  const paragraph = (value: string, size = 9) => {
    doc.setFontSize(size);
    doc.setTextColor(72, 89, 79);
    const lines: string[] = doc.splitTextToSize(value, contentWidth);
    for (const line of lines) {
      ensure(5);
      doc.text(line, left, y);
      y += 4.6;
    }
  };
  const section = (value: string, room = 21) => {
    ensure(room);
    text(value, 13, [19, 61, 43]);
    y += 5;
  };
  const table = (head: string[], body: Array<Array<string | number>>, options: Partial<UserOptions> = {}) => {
    autoTable(doc, {
      startY: y, margin: { left, right: left, top: 26, bottom: 21 }, head: [head], body,
      theme: 'striped', showHead: 'everyPage', rowPageBreak: 'avoid',
      styles: { font: fontName, fontStyle: 'normal', fontSize: 8, cellPadding: 2, textColor: [35, 54, 44], overflow: 'linebreak' },
      headStyles: { fontStyle: 'normal', fillColor: [27, 78, 56], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [238, 244, 239] },
      ...options,
    });
    y = ((doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 9;
  };

  doc.setProperties({ title: 'VisionGuard | ' + heading, subject: 'Traffic analysis and human review', creator: 'VisionGuard' });
  doc.setFillColor(20, 54, 40);
  doc.rect(0, 0, pageWidth, 45, 'F');
  y = 15;
  text('VISIONGUARD', 10, [186, 231, 202]);
  y = 30;
  text(heading, 24, [248, 255, 250]);
  y = 39;
  text(date.format(generatedAt) + ' · ' + timeZone, 9, [220, 240, 228]);
  y = 54;
  paragraph('Scope · ' + scope);
  const latest = records.at(-1);
  if (latest && records[0]) paragraph('Session dates · ' + date.format(latest.createdAt) + ' to ' + date.format(records[0].createdAt));
  y += 3;

  const metrics: Array<[string, number]> = [
    ['Sessions', totals.runs], ['Repeated tracks', totals.vehicles], ['Review flags', totals.violations],
  ];
  ensure(23);
  metrics.forEach(([label, count], index) => {
    const x = left + index * 61;
    doc.setFillColor(233, 244, 236);
    doc.roundedRect(x, y, 58, 18, 2, 2, 'F');
    doc.setTextColor(57, 82, 67);
    doc.setFontSize(9);
    doc.text(label, x + 4, y + 6);
    doc.setTextColor(19, 61, 43);
    doc.setFontSize(16);
    doc.text(formatted.format(count), x + 4, y + 14);
  });
  y += 25;

  section('Analysis overview');
  paragraph(formatted.format(totals.analyzedFrames) + ' inference frames · ' + formatted.format(totals.vehicles + totals.transientTrackCandidates) + ' stored observation rows');
  paragraph('Review status · ' + totals.pendingReviews + ' needs review · ' + totals.reviewedFlags + ' reviewed · ' + totals.dismissedFlags + ' dismissed');
  y += 5;

  section('Vehicle classes · repeated tracks');
  const classes = breakdown(totals.distribution);
  const max = classes[0]?.count ?? 1;
  if (!classes.length) paragraph('No repeated tracks in this scope.');
  for (const { name, count } of classes) {
    ensure(6);
    const label = doc.splitTextToSize(name, 46)[0];
    text(label, 9, [41, 63, 50]);
    doc.setFillColor(228, 237, 230);
    doc.rect(63, y - 2.8, 103, 3.1, 'F');
    doc.setFillColor(35, 114, 80);
    doc.rect(63, y - 2.8, 103 * count / max, 3.1, 'F');
    text(formatted.format(count), 9, [41, 63, 50], 171);
    y += 5.7;
  }
  y += 6;

  section('Sessions');
  if (!records.length) paragraph('No saved sessions match this scope.');
  else table(['Source and session ID', 'Started', 'Repeated', 'Stored rows', 'Flags'],
    records.map(run => [
      run.sourceName + '\n' + run.id, date.format(run.createdAt), ...sessionCounts(run),
    ]), { columnStyles: { 0: { cellWidth: 81 }, 1: { cellWidth: 41 } } });

  section('Method and limitations');
  paragraph('A repeated track meets the session’s observation, duration and confidence rules. Tracking interruptions and replays can count the same physical vehicle more than once. Detector candidates, track rows and inference frames describe different populations.');
  paragraph('Speed values are uncalibrated estimates from image motion. Automatic flags are candidates for human review. Reviewed status records a person’s decision and carries no enforcement finding.');
  y += 6;

  if (type === 'detailed') for (const run of records) {
    section('Session detail', 40);
    paragraph(run.sourceName + ' · ' + analysisSource(run));
    paragraph('Session ID · ' + run.id);
    paragraph('Started · ' + date.format(run.createdAt));
    y += 3;
    section('Vehicle observations', 21);
    const vehicles = vehicleRows(run);
    if (!vehicles.length) paragraph('No observation rows saved for this session.');
    else table(['Track', 'Class', 'Conf. (%)', 'First (s)', 'Last (s)', 'Samples', 'Est. km/h', 'Repeated'],
      vehicles.map(track => [track.id, track.type, track.confidence || '-', track.first || '-', track.last || '-',
        track.observations, track.speed || '-', track.repeated]));
    section('Incident review');
    const flags = incidentRows(run);
    if (!flags.length) paragraph('No review flags saved for this session.');
    else table(['ID / track', 'Source / observed', 'Reason / status', 'Evidence'],
      flags.map(flag => [flag.id + '\nTrack ' + (flag.track ?? '—'), flag.origin + '\n' + date.format(flag.observedAt),
        flag.reason + '\n' + flag.status, flag.note]),
      { columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 43 }, 2: { cellWidth: 37 }, 3: { cellWidth: 68 } } });
    y += 7;
  }

  const pages = doc.getNumberOfPages();
  for (let index = 1; index <= pages; index++) {
    doc.setPage(index);
    if (index > 1) {
      y = 16;
      text('VISIONGUARD  /  ' + heading, 9, [35, 79, 57]);
    }
    doc.setDrawColor(190, 209, 197);
    doc.line(left, 280, pageWidth - left, 280);
    y = 286;
    text('VisionGuard · ' + date.format(generatedAt), 8, [72, 89, 79]);
    doc.text(index + ' / ' + pages, pageWidth - left, y, { align: 'right' });
  }
  return doc;
}
