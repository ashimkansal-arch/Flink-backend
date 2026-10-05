import { privateS3 } from "../lib/s3";
import { extensionFromFilename, validateFileUpload } from "../lib/file-upload";
import {
  CATALOG_ICON_UPLOAD,
  catalogIconObjectKey,
  optimizeCatalogIcon,
  resolveCatalogIconDisplayUrl,
} from "../lib/catalog-icon";

export const adminCategoryIconService = {
  async upload(file: { filename: string; mimetype: string; buffer: Buffer }) {
    const extension = extensionFromFilename(file.filename);
    validateFileUpload(file.mimetype, extension, file.buffer.length, CATALOG_ICON_UPLOAD);
    const optimized = await optimizeCatalogIcon(file.buffer);
    const iconUrl = catalogIconObjectKey(privateS3.newFileId());
    await privateS3.upload(iconUrl, optimized.buffer, optimized.contentType);
    return {
      iconUrl,
      iconDisplayUrl: await resolveCatalogIconDisplayUrl(iconUrl),
    };
  },
};
