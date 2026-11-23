import { type UserJacket, USER_JACKET_LIMITS, detectImageType } from './userJackets';

/**
 * 自分で選んだ画像を、ジャケット表示用に縮小して JPEG に変換する。
 *
 * - 長辺を USER_IMAGE_MAX_EDGE px 以下に縮小（端末の保存容量・バックアップの大きさを抑える）
 * - 必ず描き直して保存するので、写真に含まれる位置情報などの付加情報（Exif）は保存されない
 * - 透過PNGは白背景にする
 */
export const USER_IMAGE_MAX_EDGE = 800;
/** 選べる元画像の最大サイズ（スマホのカメラ写真を想定） */
export const USER_IMAGE_INPUT_MAX_BYTES = 40 * 1024 * 1024;
const JPEG_QUALITY = 0.86;

export class ImageProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageProcessError';
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* 下の <img> での読み込みを試す（一部のブラウザ・形式向け） */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageProcessError('画像を読み込めませんでした。JPEG・PNG などの画像ファイルを選んでください。');
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** 縮小後のサイズ（縦横比を保つ。小さい画像は拡大しない） */
export function fitWithin(width: number, height: number, maxEdge = USER_IMAGE_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 選んだ画像ファイルを、保存用の UserJacket に変換する */
export async function processUserImage(file: Blob, id: string, now = new Date()): Promise<UserJacket> {
  if (file.size === 0) throw new ImageProcessError('ファイルが空です。');
  if (file.size > USER_IMAGE_INPUT_MAX_BYTES) throw new ImageProcessError('画像ファイルが大きすぎます（40MBまで）。');
  if (file.type && !file.type.startsWith('image/')) throw new ImageProcessError('画像ファイルを選んでください。');

  const d = await decode(file);
  try {
    if (!(d.width > 0 && d.height > 0)) throw new ImageProcessError('画像を読み込めませんでした。');
    const size = fitWithin(d.width, d.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageProcessError('画像を変換できませんでした。');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(d.source, 0, 0, size.width, size.height);
    const blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    if (!blob) throw new ImageProcessError('画像を変換できませんでした。');
    const data = await blob.arrayBuffer();
    if (data.byteLength > USER_JACKET_LIMITS.bytes) throw new ImageProcessError('変換後の画像が大きすぎます。');
    if (detectImageType(new Uint8Array(data, 0, Math.min(16, data.byteLength))) !== 'image/jpeg') {
      throw new ImageProcessError('画像を変換できませんでした。');
    }
    return { id, type: 'image/jpeg', data, updatedAt: now.toISOString() };
  } finally {
    d.release();
  }
}
