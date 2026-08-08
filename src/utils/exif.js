function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function formatFocal(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return String(value || '').trim();
  return `${number % 1 === 0 ? number : number.toFixed(1)}mm`;
}

function formatAperture(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return String(value || '').trim();
  return `f/${number % 1 === 0 ? number : number.toFixed(1)}`;
}

function formatShutter(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return String(value || '').trim();
  if (number < 1) return `1/${Math.max(1, Math.round(1 / number))}`;
  return `${number}s`;
}

function formatShotAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  return normalized.replace('T', ' ').slice(0, 19);
}

export function buildShotDefaultsFromExif(raw = {}) {
  const exif = raw && typeof raw === 'object' ? raw : {};
  const make = String(firstValue(exif.Make, exif.make) || '').trim();
  const model = String(firstValue(exif.Model, exif.model) || '').trim();
  const camera = model && make && model.toLowerCase().startsWith(make.toLowerCase())
    ? model
    : [make, model].filter(Boolean).join(' ');
  const iso = firstValue(exif.ISOSpeedRatings, exif.ISO, exif.iso);

  return {
    camera,
    lens: String(firstValue(exif.LensModel, exif.Lens, exif.lens) || '').trim(),
    focal: formatFocal(firstValue(exif.FocalLength, exif.focalLength)),
    aperture: formatAperture(firstValue(exif.FNumber, exif.ApertureValue, exif.aperture)),
    shutter: formatShutter(firstValue(exif.ExposureTime, exif.ShutterSpeedValue, exif.shutter)),
    iso: Array.isArray(iso) ? String(iso[0] || '').trim() : String(iso || '').trim(),
    whiteBalance: String(firstValue(exif.WhiteBalance, exif.whiteBalance) || '').trim(),
    shotAt: formatShotAt(firstValue(exif.DateTimeOriginal, exif.DateTime, exif.dateTime)),
  };
}
