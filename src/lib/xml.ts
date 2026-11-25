import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
  isArray: (name) =>
    [
      "sheet",
      "si",
      "t",
      "r",
      "rPh",
      "fill",
      "xf",
      "c",
      "row",
      "mergeCell",
      "conditionalFormatting",
      "drawing",
      "Relationship",
    ].includes(name),
});

export type XmlNode = Record<string, unknown>;

export function parseXml(xml: string | Buffer): XmlNode {
  const text = typeof xml === "string" ? xml : xml.toString("utf8");
  return parser.parse(text) as XmlNode;
}

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function attr(node: XmlNode | undefined, key: string): string | undefined {
  if (!node) return undefined;
  const v = node[`@_${key}`];
  return v == null ? undefined : String(v);
}

export function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const o = node as XmlNode;
    if (o["#text"] != null) return String(o["#text"]);
  }
  return "";
}

/** Collect direct/nested `t` text nodes, excluding rPh phonetic runs. */
export function collectT(node: XmlNode | undefined): string {
  if (!node) return "";
  let out = "";
  for (const t of asArray(node.t as XmlNode | XmlNode[] | string | undefined)) {
    out += typeof t === "string" || typeof t === "number" ? String(t) : textOf(t);
  }
  for (const r of asArray(node.r as XmlNode | XmlNode[] | undefined)) {
    out += collectT(r);
  }
  return out;
}

export function deepFindAll(node: unknown, name: string, acc: XmlNode[] = []): XmlNode[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const item of node) deepFindAll(item, name, acc);
    return acc;
  }
  const o = node as XmlNode;
  if (Object.prototype.hasOwnProperty.call(o, name)) {
    for (const child of asArray(o[name] as XmlNode | XmlNode[])) {
      if (child && typeof child === "object") acc.push(child as XmlNode);
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith("@_") || k === "#text") continue;
    deepFindAll(v, name, acc);
  }
  return acc;
}
