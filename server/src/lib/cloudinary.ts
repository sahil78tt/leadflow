import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

export const isCloudinaryConfigured = () =>
  Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET,
  );

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

function requireConfigured() {
  if (!isCloudinaryConfigured())
    throw new Error("Cloudinary is not configured");
}

export interface DocumentStorage {
  upload(
    buffer: Buffer,
    folder: string,
  ): Promise<{ publicId: string; format: string }>;
  /** A short-lived, signed link. There is no permanent URL for a document. */
  downloadUrl(publicId: string, format: string): string;
}

async function uploadToCloudinary(buffer: Buffer, folder: string) {
  requireConfigured();
  return await new Promise<{ publicId: string; format: string }>(
    (resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        // "authenticated": not reachable by URL without a signature (mortgage documents are private)
        { folder, resource_type: "image", type: "authenticated" },
        (error, result) => {
          if (error || !result)
            return reject(error ?? new Error("Upload failed"));
          resolve({ publicId: result.public_id, format: result.format });
        },
      );
      stream.end(buffer);
    },
  );
}

function cloudinaryDownloadUrl(publicId: string, format: string) {
  requireConfigured();
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 300, // 5 minutes
  });
}

// An object (not bare functions) so tests can swap it without touching the network.
export const storage: DocumentStorage = {
  upload: uploadToCloudinary,
  downloadUrl: cloudinaryDownloadUrl,
};
