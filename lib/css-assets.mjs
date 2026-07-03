const FONT_EXT_PATTERN = /\.(woff2?|ttf|otf|eot)([?#]|$)/i;
const CSS_EXT_PATTERN = /\.css([?#]|$)/i;
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)([?#]|$)/i;

const URL_REF_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const IMPORT_STRING_PATTERN = /@import\s+(['"])([^'"]+)\1/g;

export function folderForAssetUrl(url) {
  const value = String(url || "");
  if (FONT_EXT_PATTERN.test(value)) {
    return { folder: "fonts", ext: ".woff2" };
  }
  if (CSS_EXT_PATTERN.test(value)) {
    return { folder: "css", ext: ".css" };
  }
  if (IMAGE_EXT_PATTERN.test(value)) {
    return { folder: "img", ext: ".png" };
  }
  return { folder: "img", ext: ".png" };
}

export function shortHash(value) {
  let hash = 5381;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 7);
}

export function assignAssetPath(absUrl, folder, extFallback, usedPaths) {
  let filename = String(absUrl).split("/").pop().split("?")[0].split("#")[0];
  if (!filename || !filename.includes(".")) {
    filename = `asset_${shortHash(absUrl)}${extFallback}`;
  }

  let relativePath = `${folder}/${filename}`;
  if (usedPaths.has(relativePath)) {
    const dotIndex = filename.lastIndexOf(".");
    const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
    const ext = dotIndex > 0 ? filename.slice(dotIndex) : extFallback;
    relativePath = `${folder}/${base}_${shortHash(absUrl)}${ext}`;
  }
  usedPaths.add(relativePath);
  return relativePath;
}

export function relativePathBetween(fromPath, toPath) {
  const fromParts = String(fromPath).split("/").filter(Boolean);
  const toParts = String(toPath).split("/").filter(Boolean);
  fromParts.pop(); // drop the filename, keep the directory

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }

  const ups = fromParts.length - common;
  const segments = [];
  for (let i = 0; i < ups; i++) {
    segments.push("..");
  }
  segments.push(...toParts.slice(common));
  return segments.join("/");
}

/**
 * Rewrites every url(...) and @import "..." reference in a CSS text.
 * The resolver receives (rawRef, isImport) and returns the replacement
 * path, or null to keep the original reference untouched.
 */
export function rewriteCssText(cssText, resolver) {
  let output = String(cssText).replace(URL_REF_PATTERN, (full, _quote, rawUrl) => {
    const trimmed = rawUrl.trim();
    if (isLocalRef(trimmed)) {
      return full;
    }
    const replacement = resolver(trimmed, false);
    return replacement ? `url("${replacement}")` : full;
  });

  output = output.replace(IMPORT_STRING_PATTERN, (full, _quote, rawUrl) => {
    const trimmed = rawUrl.trim();
    if (isLocalRef(trimmed)) {
      return full;
    }
    const replacement = resolver(trimmed, true);
    return replacement ? `@import "${replacement}"` : full;
  });

  return output;
}

function isLocalRef(ref) {
  return (
    !ref ||
    ref.startsWith("data:") ||
    ref.startsWith("#") ||
    ref.startsWith("blob:") ||
    ref.startsWith("chrome-extension:")
  );
}

/**
 * Fetches every CSS asset, downloads the resources it references
 * (fonts, background images, @import chains) and rewrites the CSS
 * to use local relative paths.
 *
 * Returns { rewrittenCss: [{ path, text }], extraAssets: [{ url, path }] }.
 * `fetchText` is injectable for testing: (url) => Promise<string>.
 */
export async function processCssAssets(initialAssets, fetchText, limits = {}) {
  const maxCssFiles = limits.maxCssFiles ?? 40;
  const maxAssets = limits.maxAssets ?? 400;

  const urlToPath = new Map(initialAssets.map((asset) => [asset.url, asset.path]));
  const usedPaths = new Set(initialAssets.map((asset) => asset.path));
  const queue = initialAssets.filter((asset) => asset.path.startsWith("css/"));
  const processedUrls = new Set();

  const rewrittenCss = [];
  const extraAssets = [];

  while (queue.length > 0 && rewrittenCss.length < maxCssFiles) {
    const cssAsset = queue.shift();
    if (processedUrls.has(cssAsset.url)) {
      continue;
    }
    processedUrls.add(cssAsset.url);

    let cssText;
    try {
      cssText = await fetchText(cssAsset.url);
    } catch (error) {
      // Unreachable CSS: it will still be downloaded from its original URL.
      continue;
    }

    const rewritten = rewriteCssText(cssText, (rawRef, isImport) => {
      let absUrl;
      try {
        absUrl = new URL(rawRef, cssAsset.url).href;
      } catch (error) {
        return null;
      }

      let path = urlToPath.get(absUrl);
      if (!path) {
        if (urlToPath.size >= maxAssets) {
          return null;
        }
        const target = isImport ? { folder: "css", ext: ".css" } : folderForAssetUrl(absUrl);
        path = assignAssetPath(absUrl, target.folder, target.ext, usedPaths);
        urlToPath.set(absUrl, path);
        const record = { url: absUrl, path };
        extraAssets.push(record);
        if (target.folder === "css") {
          queue.push(record);
        }
      }
      return relativePathBetween(cssAsset.path, path);
    });

    rewrittenCss.push({ path: cssAsset.path, text: rewritten });
  }

  return { rewrittenCss, extraAssets };
}
