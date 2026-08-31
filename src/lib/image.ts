/**
 * Pictures are normalized in the BROWSER before upload: fitted into a 512px
 * square and re-encoded. That turns an arbitrary camera photo into a few tens
 * of kilobytes, which is what lets the upload be one ordinary JSON request
 * instead of a presigned-PUT dance — and it means every picture in the app is
 * already the shape it is drawn in.
 *
 * The two callers fit differently, because they are different kinds of
 * picture. An avatar is CENTRE-CROPPED to fill the square: faces sit in the
 * middle and the frame is always drawn round, so the corners were never going
 * to be seen. A logo is CONTAINED inside it instead — a wordmark cropped to a
 * square stops being the wordmark — and encoded as PNG so a transparent
 * background stays transparent rather than turning into a white card.
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
  contentType: "image/jpeg" | "image/png"
  /** Base64 with the `data:` prefix stripped, ready for the API body. */
  data: string
  /** Same bytes as an object URL, for an immediate optimistic preview. */
  previewUrl: string
}

/** A profile picture: centre-cropped square, JPEG. */
export function encodeAvatar(file: File): Promise<EncodedImage> {
  return encode(file, "cover", "image/jpeg")
}

/**
 * An organization or workspace logo: fitted inside the square, PNG so
 * transparency survives.
 */
export function encodeLogo(file: File): Promise<EncodedImage> {
  return encode(file, "contain", "image/png")
}

async function encode(
  file: File,
  fit: "cover" | "contain",
  contentType: EncodedImage["contentType"]
): Promise<EncodedImage> {
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
  // Never upscale: a 96px source stays 96px rather than being blown up. The
  // square is sized off the SHORT edge when cropping (that is the largest
  // square inside the original) and off the LONG edge when fitting (that is
  // the smallest square the original fits inside).
  const edge =
    fit === "cover"
      ? Math.min(bitmap.width, bitmap.height)
      : Math.max(bitmap.width, bitmap.height)
  const size = Math.min(TARGET_PX, edge)

  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not process that image")
  if (fit === "cover") {
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
  } else {
    // Destination-fitted: the whole original, centred, letterboxed by the
    // canvas's own transparency.
    const scale = size / edge
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height)
  }
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, contentType, 0.9)
  )
  if (!blob) throw new Error("Could not process that image")
  // The server's ceiling. A 512px JPEG lands far below it, and so does a 512px
  // PNG of ordinary logo art; a photograph saved as PNG can not, and says so
  // here rather than as a 400.
  if (blob.size > MAX_ENCODED_BYTES) {
    throw new Error("That image is too detailed to use as a picture; try a simpler one")
  }

  return {
    contentType,
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
