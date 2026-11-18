import {get, put, remove} from './store.js';

export const PHOTO_LIMIT = 5 * 1024 * 1024;
export function checkPhotoFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw Error('Pilih foto JPG, PNG, atau WebP.');
  if (!file.size || file.size > PHOTO_LIMIT)
    throw Error('Ukuran foto harus antara 1 byte dan 5 MB.');
}
export function avatarKind(gender) {
  return gender === 'Pria' ? 'male' : gender === 'Wanita' ? 'female' : 'neutral';
}
export async function preparePhoto(file) {
  checkPhotoFile(file);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  const webp = String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!({ 'image/jpeg':jpeg, 'image/png':png, 'image/webp':webp }[file.type]))
    throw Error('Isi file tidak sesuai format gambar.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 24000000)
      throw Error('Dimensi foto maksimal 24 megapiksel.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw Error('Browser tidak dapat mengolah foto.');
    context.fillStyle = '#e4f2fc';
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2,
      side, side, 0, 0, 256, 256);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw Error('Foto tidak dapat disimpan.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function photoURL(owner) {
  const row = await get('photos', owner);
  return row?.blob instanceof Blob ? URL.createObjectURL(row.blob) : '';
}
export const savePhoto = (owner, blob) => put('photos', {owner, blob, at:Date.now()});
export const deletePhoto = owner => remove('photos', owner);
