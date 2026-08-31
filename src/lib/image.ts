/**
 * Profile pictures are normalized in the BROWSER before upload: centre-cropped
 * to a square, capped at 512px, re-encoded as JPEG. That turns an arbitrary
 * camera photo into a few tens of kilobytes, which is what lets the upload be
 * one ordinary JSON request instead of a presigned-PUT dance — and it means
 * every avatar in the app is already the shape it is drawn in.
 *
 * Cropping rather than fitting is deliberate: an avatar is always drawn round,
 * so the corners were never going to be seen, and faces sit in the middle.
 *
 * The server still validates type and size (services/images.ts); this is
 * convenience, not the gate.
 */

/** Longest edge of the stored picture. Twice the largest place it is drawn. */
const TARGET_PX = 512

/** Rejected before decoding — a guard against handing a huge file to the GPU. */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024

/** Mirrors MAX_IMAGE_BYTES in the backend's services/images.ts. */
const MAX_ENCODED_BYTES = 1_500_000

export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]

export interface EncodedImage {
  contentType: "image/jpeg"
  /** Base64 with the `data:` prefix stripped, ready for the API body. */
  data: string
  /** Same bytes as an object URL, for an immediate optimistic preview. */
  previewUrl: string
}

export async function encodeAvatar(file: File): Promise<EncodedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file")
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("That image is larger than 15 MB")
  }

  // `from-image` applies EXIF orientation, so a phone photo is not stored
  // sideways — canvas drawing would otherwise ignore the tag entirely.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  })
  // Never upscale: a 96px source stays 96px rather than being blown up.
  const edge = Math.min(bitmap.width, bitmap.height)
  const size = Math.min(TARGET_PX, edge)

  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not process that image")
  // Source-cropped: take the largest centred square of the original.
  ctx.drawImage(
    bitmap,
    (bitmap.width - edge) / 2,
    (bitmap.height - edge) / 2,
    edge,
    edge,
    0,
    0,
    size,
    size
  )
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9)
  )
  if (!blob) throw new Error("Could not process that image")
  // The server's ceiling. A 512px JPEG lands far below it, so this only fires
  // if TARGET_PX or the quality above is retuned — better here than as a 400.
  if (blob.size > MAX_ENCODED_BYTES) {
    throw new Error("That image is too large to use as a picture")
  }

  return {
    contentType: "image/jpeg",
    data: await base64(blob),
    previewUrl: URL.createObjectURL(blob),
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read that image"))
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.readAsDataURL(blob)
  })
}
