/**
 * Live Figma tab probe (MAIN world, classic script).
 *
 * Injected with chrome.scripting.executeScript({ world: "MAIN", files: [...] }).
 * When the editor page exposes the `figma` plugin-API global (it does after a
 * plugin or the developer console has used it in this session), the document
 * is walked into the REST `GET /v1/files/:key` shape consumed by
 * lib/figma-import.mjs, plus bounded PNG renders of the top frames.
 * Otherwise it returns { available: false, reason } and does nothing else:
 * no access control is bypassed, only what the page already exposes is read.
 *
 * The last expression is a Promise: executeScript resolves with its value.
 */
(async () => {
  const MAX_NODES = 60000;
  const MAX_RENDERS = 6;
  const MAX_RENDER_WIDTH = 1440;
  const MAX_RENDER_BYTES = 12 * 1024 * 1024;
  const MAX_IMAGES = 12;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

  const api = typeof figma !== "undefined" ? figma : null;
  if (!api || !api.root) {
    return {
      available: false,
      reason: "L'API Figma n'est pas exposée dans cet onglet : ouvrez un fichier dans l'éditeur Figma et lancez un plugin (ou utilisez l'import par copier-coller ou par fichier .fig)."
    };
  }

  const mixed = api.mixed;
  const isMixed = (value) => value === mixed || typeof value === "symbol";
  const safe = (read, fallback) => {
    try {
      const value = read();
      return isMixed(value) ? fallback : value;
    } catch (error) {
      return fallback;
    }
  };

  const bytesToBase64 = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };

  // Plugin gradientTransform maps node space to gradient space: REST handles
  // are the inverse image of the gradient axis points.
  const gradientHandles = (paint) => {
    const t = paint.gradientTransform || [[1, 0, 0], [0, 1, 0]];
    const [[a, b, c], [d, e, f]] = t;
    const det = a * e - b * d;
    if (!det) return [];
    const ia = e / det;
    const ib = -b / det;
    const id = -d / det;
    const ie = a / det;
    const ic = -(ia * c + ib * f);
    const ifv = -(id * c + ie * f);
    const points = paint.type === "GRADIENT_LINEAR" ? [[0, 0.5], [1, 0.5], [0, 1]] : [[0.5, 0.5], [1, 0.5], [0.5, 1]];
    return points.map(([x, y]) => ({ x: ia * x + ib * y + ic, y: id * x + ie * y + ifv }));
  };

  const imageRefs = new Set();
  const convertPaint = (paint) => {
    const out = { type: paint.type, visible: paint.visible !== false, opacity: paint.opacity ?? 1, blendMode: paint.blendMode || "NORMAL" };
    if (paint.type === "SOLID") out.color = { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: 1 };
    else if (String(paint.type).startsWith("GRADIENT_")) {
      out.gradientStops = (paint.gradientStops || []).map((stop) => ({ color: { ...stop.color }, position: stop.position }));
      out.gradientHandlePositions = gradientHandles(paint);
    } else if (paint.type === "IMAGE") {
      out.scaleMode = paint.scaleMode || "FILL";
      if (paint.imageHash) {
        out.imageRef = paint.imageHash;
        imageRefs.add(paint.imageHash);
      }
    }
    return out;
  };
  const paints = (value) => (Array.isArray(value) ? value.map(convertPaint) : []);

  const lineHeightOf = (lineHeight, fontSize) => {
    if (!lineHeight || lineHeight.unit === "AUTO") return { lineHeightUnit: "INTRINSIC_%", lineHeightPercent: 100 };
    if (lineHeight.unit === "PIXELS") return { lineHeightPx: lineHeight.value, lineHeightUnit: "PIXELS" };
    return { lineHeightPx: (lineHeight.value / 100) * fontSize, lineHeightUnit: "FONT_SIZE_%", lineHeightPercentFontSize: lineHeight.value };
  };
  const letterSpacingOf = (spacing, fontSize) => {
    if (!spacing) return 0;
    return spacing.unit === "PERCENT" ? (spacing.value / 100) * fontSize : spacing.value;
  };
  const textStyleOf = (segment) => {
    const fontSize = segment.fontSize || 12;
    const font = segment.fontName || {};
    const style = {
      fontFamily: font.family || "",
      fontStyle: font.style || "Regular",
      fontWeight: segment.fontWeight || 400,
      italic: /italic|oblique/i.test(font.style || ""),
      fontSize,
      letterSpacing: letterSpacingOf(segment.letterSpacing, fontSize),
      ...lineHeightOf(segment.lineHeight, fontSize)
    };
    if (segment.textCase && segment.textCase !== "ORIGINAL") style.textCase = segment.textCase;
    if (segment.textDecoration && segment.textDecoration !== "NONE") style.textDecoration = segment.textDecoration;
    return style;
  };

  // Mixed-style text: the longest run is the base style, other runs become
  // the REST characterStyleOverrides / styleOverrideTable pair.
  const applyText = (out, node) => {
    out.characters = node.characters || "";
    const fields = ["fontName", "fontSize", "fontWeight", "fills", "lineHeight", "letterSpacing", "textCase", "textDecoration"];
    const segments = safe(() => node.getStyledTextSegments(fields), []) || [];
    if (segments.length === 0) {
      out.style = textStyleOf({});
      return;
    }
    const base = segments.reduce((best, segment) => (segment.end - segment.start > best.end - best.start ? segment : best), segments[0]);
    out.style = {
      ...textStyleOf(base),
      textAlignHorizontal: safe(() => node.textAlignHorizontal, "LEFT"),
      textAlignVertical: safe(() => node.textAlignVertical, "TOP"),
      textAutoResize: safe(() => node.textAutoResize, "NONE")
    };
    out.fills = paints(base.fills);
    const overrides = new Array(out.characters.length).fill(0);
    const table = {};
    let nextId = 1;
    for (const segment of segments) {
      if (segment === base) continue;
      const id = nextId;
      nextId += 1;
      table[id] = { ...textStyleOf(segment), fills: paints(segment.fills) };
      for (let i = segment.start; i < segment.end; i += 1) overrides[i] = id;
    }
    while (overrides.length > 0 && overrides[overrides.length - 1] === 0) overrides.pop();
    out.characterStyleOverrides = overrides;
    out.styleOverrideTable = table;
  };

  const styles = {};
  const components = {};
  const componentSets = {};
  const getStyle = async (id) => {
    if (!id || isMixed(id)) return null;
    try {
      return api.getStyleByIdAsync ? await api.getStyleByIdAsync(id) : api.getStyleById(id);
    } catch (error) {
      return null;
    }
  };
  const STYLE_FIELDS = { fillStyleId: "fill", strokeStyleId: "stroke", textStyleId: "text", effectStyleId: "effect", gridStyleId: "grid" };
  const applyStyles = async (out, node) => {
    const refs = {};
    for (const [field, key] of Object.entries(STYLE_FIELDS)) {
      const id = safe(() => node[field], "");
      if (!id) continue;
      const style = await getStyle(id);
      if (!style) continue;
      refs[key] = style.id;
      styles[style.id] = { key: style.key || "", name: style.name || "", styleType: style.type === "PAINT" ? "FILL" : style.type, description: style.description || "", remote: Boolean(style.remote) };
    }
    if (Object.keys(refs).length > 0) out.styles = refs;
  };

  const registerComponent = (main) => {
    if (!main || components[main.id]) return;
    const parent = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
    components[main.id] = { key: main.key || "", name: main.name || "", description: main.description || "", remote: Boolean(main.remote), documentationLinks: [], ...(parent ? { componentSetId: parent.id } : {}) };
    if (parent && !componentSets[parent.id]) componentSets[parent.id] = { key: parent.key || "", name: parent.name || "", description: parent.description || "", remote: Boolean(parent.remote) };
  };

  const COPIED = [
    "opacity", "blendMode", "isMask", "clipsContent", "strokeWeight", "strokeAlign", "cornerRadius",
    "layoutMode", "itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "primaryAxisAlignItems", "counterAxisAlignItems",
    "primaryAxisSizingMode", "counterAxisSizingMode", "layoutWrap", "counterAxisSpacing", "layoutGrow", "layoutAlign", "layoutPositioning",
    "layoutSizingHorizontal", "layoutSizingVertical", "minWidth", "maxWidth", "minHeight", "maxHeight", "constraints", "description"
  ];

  let count = 0;
  let truncated = false;
  const convert = async (node) => {
    count += 1;
    const out = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false };
    const box = safe(() => node.absoluteBoundingBox, null);
    if (box) out.absoluteBoundingBox = { x: box.x, y: box.y, width: box.width, height: box.height };
    for (const field of COPIED) {
      if (!(field in node)) continue;
      const value = safe(() => node[field], undefined);
      if (value !== undefined && value !== null) out[field] = value;
    }
    if ("fills" in node) out.fills = paints(safe(() => node.fills, []));
    if ("strokes" in node) out.strokes = paints(safe(() => node.strokes, []));
    if ("effects" in node) out.effects = (safe(() => node.effects, []) || []).map((effect) => ({ ...effect }));
    if ("layoutGrids" in node) out.layoutGrids = (safe(() => node.layoutGrids, []) || []).map((grid) => ({ ...grid }));
    if ("topLeftRadius" in node && out.cornerRadius === undefined) {
      out.rectangleCornerRadii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
    }
    if ("strokeTopWeight" in node && out.strokeWeight === undefined) {
      out.individualStrokeWeights = { top: node.strokeTopWeight, right: node.strokeRightWeight, bottom: node.strokeBottomWeight, left: node.strokeLeftWeight };
    }
    if (node.type === "TEXT") applyText(out, node);
    if (node.type === "COMPONENT_SET" || (node.type === "COMPONENT" && !(node.parent && node.parent.type === "COMPONENT_SET"))) {
      const defs = safe(() => node.componentPropertyDefinitions, null);
      if (defs) out.componentPropertyDefinitions = defs;
    }
    if (node.type === "INSTANCE") {
      const main = await (node.getMainComponentAsync ? node.getMainComponentAsync().catch(() => null) : Promise.resolve(safe(() => node.mainComponent, null)));
      if (main) {
        out.componentId = main.id;
        registerComponent(main);
      }
      const props = safe(() => node.componentProperties, null);
      if (props) out.componentProperties = props;
    }
    await applyStyles(out, node);
    if ("children" in node) {
      out.children = [];
      for (const child of node.children) {
        if (count >= MAX_NODES) {
          truncated = true;
          break;
        }
        out.children.push(await convert(child));
      }
    }
    return out;
  };

  try {
    // Dynamic page loading: other pages are only readable once loaded.
    let pages = [api.currentPage];
    try {
      if (typeof api.loadAllPagesAsync === "function") await api.loadAllPagesAsync();
      pages = [...api.root.children];
    } catch (error) {
      pages = [api.currentPage];
    }
    const doc = { id: api.root.id || "0:0", name: "Document", type: "DOCUMENT", visible: true, children: [] };
    for (const page of pages) {
      const background = safe(() => page.backgrounds, [])[0];
      const children = [];
      for (const child of page.children) {
        if (count >= MAX_NODES) {
          truncated = true;
          break;
        }
        children.push(await convert(child));
      }
      doc.children.push({
        id: page.id,
        name: page.name,
        type: "CANVAS",
        visible: true,
        ...(background && background.color ? { backgroundColor: { ...background.color, a: background.opacity ?? 1 } } : {}),
        flowStartingPoints: (safe(() => page.flowStartingPoints, []) || []).map((flow) => ({ nodeId: flow.nodeId, name: flow.name })),
        children
      });
    }

    const imageFills = {};
    let imageBytes = 0;
    for (const hash of Array.from(imageRefs).slice(0, MAX_IMAGES)) {
      try {
        const image = api.getImageByHash(hash);
        const bytes = image ? await image.getBytesAsync() : null;
        if (!bytes || imageBytes + bytes.length > MAX_IMAGE_BYTES) continue;
        imageBytes += bytes.length;
        const mime = bytes[0] === 0xff ? "image/jpeg" : bytes[0] === 0x47 ? "image/gif" : "image/png";
        imageFills[hash] = `data:${mime};base64,${bytesToBase64(bytes)}`;
      } catch (error) {
        // Unloaded or remote image: the pipeline keeps the hash reference.
      }
    }

    const renders = [];
    let renderBytes = 0;
    const frames = api.currentPage.children.filter((node) => ["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(node.type) && node.visible !== false);
    for (const frame of frames.slice(0, MAX_RENDERS)) {
      try {
        const width = Math.min(MAX_RENDER_WIDTH, Math.max(1, Math.round(frame.width)));
        const bytes = await frame.exportAsync({ format: "PNG", constraint: { type: "WIDTH", value: width } });
        if (renderBytes + bytes.length > MAX_RENDER_BYTES) break;
        renderBytes += bytes.length;
        renders.push({ id: frame.id, name: frame.name, width: frame.width, height: frame.height, dataUrl: `data:image/png;base64,${bytesToBase64(bytes)}` });
      } catch (error) {
        // One failed render does not block the others.
      }
    }

    const file = {
      name: api.root.name || "Fichier Figma",
      lastModified: "",
      version: "",
      editorType: api.editorType || "figma",
      thumbnailUrl: "",
      document: doc,
      components,
      componentSets,
      styles
    };
    return {
      available: true,
      file,
      imageFills,
      renders,
      source: { kind: "live", fileKey: safe(() => api.fileKey, "") || "", pages: doc.children.length, nodes: count, truncated, renders: renders.length }
    };
  } catch (error) {
    return { available: false, reason: `Lecture du document Figma impossible : ${error && error.message ? error.message : error}` };
  }
})();
