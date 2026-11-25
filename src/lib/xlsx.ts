import JSZip from "jszip";
import path from "path";
import { col } from "./util";
import type { CellData, Drawing, Rgb, SheetData } from "./types";
import {
  asArray,
  attr,
  collectT,
  deepFindAll,
  parseXml,
  textOf,
  type XmlNode,
} from "./xml";

function emptyCell(): CellData {
  return { value: "", color: "", gray: false, exists: false, formula: false, fillId: 0 };
}

function colorToRgb(node: XmlNode | undefined, theme: (Rgb | undefined)[]): Rgb | null {
  if (!node) return null;
  const rgb = attr(node, "rgb");
  if (rgb) {
    const s = rgb.slice(-6);
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  const themeIdx = attr(node, "theme");
  if (themeIdx != null) {
    const idx = Number(themeIdx);
    const base = theme[idx];
    if (!base) return null;
    const tint = Number(attr(node, "tint") ?? "0");
    const apply = (c: number) =>
      tint < 0 ? Math.round(c * (1 + tint)) : Math.round(c * (1 - tint) + 255 * tint);
    return [
      Math.max(0, Math.min(255, apply(base[0]))),
      Math.max(0, Math.min(255, apply(base[1]))),
      Math.max(0, Math.min(255, apply(base[2]))),
    ];
  }
  const indexed = attr(node, "indexed");
  if (indexed === "0") return [0, 0, 0];
  if (indexed === "1") return [255, 255, 255];
  return null;
}

function readTheme(files: Map<string, Buffer>): (Rgb | undefined)[] {
  const raw = files.get("xl/theme/theme1.xml");
  if (!raw) return [[255, 255, 255], [0, 0, 0]];
  const xml = parseXml(raw);
  const cs = deepFindAll(xml, "clrScheme")[0];
  if (!cs) return [];
  const scheme: Record<string, Rgb> = {};
  for (const [tag, val] of Object.entries(cs)) {
    if (tag.startsWith("@_") || tag === "#text") continue;
    const item = asArray(val as XmlNode | XmlNode[])[0];
    if (!item || typeof item !== "object") continue;
    const child = Object.values(item).find(
      (v) => v && typeof v === "object" && !Array.isArray(v),
    ) as XmlNode | undefined;
    if (!child) continue;
    const s = attr(child, "lastClr") || attr(child, "val");
    if (s && s.length === 6) {
      try {
        scheme[tag] = [
          parseInt(s.slice(0, 2), 16),
          parseInt(s.slice(2, 4), 16),
          parseInt(s.slice(4, 6), 16),
        ];
      } catch {
        /* ignore */
      }
    }
  }
  return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map(
    (n) => scheme[n],
  );
}

function cellText(node: XmlNode, ss: string[]): string {
  const typ = attr(node, "t");
  if (typ === "inlineStr") {
    const is = node.is as XmlNode | undefined;
    return collectT(is);
  }
  const vn = node.v;
  if (vn == null) return "";
  const raw = textOf(vn);
  if (typ === "s") return ss[Number(raw)] ?? "";
  return raw;
}

function normalizeSheetPath(target: string): string {
  if (target.startsWith("/")) return target.replace(/^\//, "");
  if (target.startsWith("xl/")) return target;
  return `xl/${target}`;
}

export class XlsxBook {
  sheets: Record<string, string> = {};
  private files: Map<string, Buffer>;
  private ss: string[] = [];
  private fills: (Rgb | null)[] = [];
  private fillsByStyle: number[] = [];

  constructor(files: Map<string, Buffer>) {
    this.files = files;
    const book = parseXml(must(files, "xl/workbook.xml"));
    const rels = parseXml(must(files, "xl/_rels/workbook.xml.rels"));
    const urls: Record<string, string> = {};
    for (const r of asArray(
      ((rels.Relationships as XmlNode)?.Relationship ?? rels.Relationship) as XmlNode | XmlNode[],
    )) {
      const id = attr(r, "Id");
      const target = attr(r, "Target");
      if (id && target) urls[id] = target;
    }
    const sheetsNode = (book.workbook as XmlNode)?.sheets as XmlNode;
    for (const s of asArray(sheetsNode?.sheet as XmlNode | XmlNode[])) {
      const name = attr(s, "name");
      const rid = attr(s, "id");
      if (!name || !rid || !urls[rid]) continue;
      const xmlpath = normalizeSheetPath(urls[rid]);
      if (!files.has(xmlpath)) throw new Error(`シートXML不明: ${xmlpath}`);
      this.sheets[name] = xmlpath;
    }

    if (files.has("xl/sharedStrings.xml")) {
      const ssRoot = parseXml(must(files, "xl/sharedStrings.xml"));
      for (const si of deepFindAll(ssRoot, "si")) {
        this.ss.push(collectT(si));
      }
    }

    const theme = readTheme(files);
    const styles = parseXml(must(files, "xl/styles.xml"));
    for (const f of deepFindAll(styles, "fill")) {
      const pattern = asArray(f.patternFill as XmlNode | XmlNode[])[0];
      if (pattern && attr(pattern, "patternType") === "solid") {
        this.fills.push(colorToRgb(asArray(pattern.fgColor as XmlNode | XmlNode[])[0], theme));
      } else {
        this.fills.push(null);
      }
    }
    for (const xf of deepFindAll(styles, "xf")) {
      // cellXfs only — style sheet has xf under cellXfs and cellStyleXfs
    }
    const cellXfs = deepFindAll(styles, "cellXfs")[0];
    this.fillsByStyle = asArray(cellXfs?.xf as XmlNode | XmlNode[]).map((x) =>
      Number(attr(x, "fillId") ?? "0"),
    );
  }

  static async fromBuffer(buf: ArrayBuffer | Buffer | Uint8Array): Promise<XlsxBook> {
    const zip = await JSZip.loadAsync(buf);
    const files = new Map<string, Buffer>();
    const tasks: Promise<void>[] = [];
    zip.forEach((name, file) => {
      if (!name.startsWith("xl/") && !name.startsWith("docProps/")) return;
      tasks.push(
        file.async("nodebuffer").then((b) => {
          files.set(name, b);
        }),
      );
    });
    await Promise.all(tasks);
    return new XlsxBook(files);
  }

  sheetNames(): string[] {
    return Object.keys(this.sheets);
  }

  read(sheet: string): SheetData {
    if (!(sheet in this.sheets)) {
      throw new Error(`存在しないシート「${sheet}」。候補：${Object.keys(this.sheets).join(", ")}`);
    }
    const xmlfile = this.sheets[sheet];
    const root = parseXml(must(this.files, xmlfile));
    const data: Record<string, CellData> = {};
    for (const node of deepFindAll(root, "c")) {
      const a = attr(node, "r");
      if (!a) continue;
      const sty = Number(attr(node, "s") ?? "0");
      const fi = sty < this.fillsByStyle.length ? this.fillsByStyle[sty] : 0;
      const rgb = fi < this.fills.length ? this.fills[fi] : null;
      const hexcolor = rgb ? "#" + rgb.map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("") : "";
      const gray = Boolean(rgb && Math.max(...rgb) - Math.min(...rgb) < 35 && rgb.reduce((s, n) => s + n, 0) / 3 < 215);
      const hasFormula = node.f != null;
      data[a] = {
        value: cellText(node, this.ss).trim(),
        color: hexcolor,
        gray,
        exists: true,
        formula: hasFormula,
        fillId: fi,
      };
    }

    const drawings: Drawing[] = [];
    const dirname = path.posix.dirname(xmlfile);
    const basename = path.posix.basename(xmlfile);
    const relfile = path.posix.join(dirname, "_rels", `${basename}.rels`);
    if (this.files.has(relfile)) {
      const relroot = parseXml(must(this.files, relfile));
      const relmap: Record<string, string> = {};
      for (const r of asArray(
        ((relroot.Relationships as XmlNode)?.Relationship ?? relroot.Relationship) as
          | XmlNode
          | XmlNode[],
      )) {
        const id = attr(r, "Id");
        const target = attr(r, "Target");
        if (id && target) relmap[id] = target;
      }
      for (const dr of deepFindAll(root, "drawing")) {
        const target = relmap[attr(dr, "id") ?? ""];
        if (!target) continue;
        const fp = target.startsWith("/")
          ? target.replace(/^\//, "")
          : path.posix.normalize(path.posix.join(dirname, target));
        if (!this.files.has(fp)) continue;
        const drroot = parseXml(must(this.files, fp));
        // Anchors are twoCellAnchor / oneCellAnchor / absoluteAnchor
        for (const tag of ["twoCellAnchor", "oneCellAnchor", "absoluteAnchor"]) {
          for (const anchor of deepFindAll(drroot, tag)) {
            const loc = asArray(anchor.from as XmlNode | XmlNode[])[0];
            if (!loc) continue;
            const texts = deepFindAll(anchor, "t").map((t) => textOf(t)).join("");
            const row = textOf(loc.row);
            const c = textOf(loc.col);
            if (texts && row !== "" && c !== "") {
              drawings.push({ 文字: texts, 行: Number(row) + 1, 列: col(Number(c) + 1) });
            }
          }
        }
      }
    }

    const merged = deepFindAll(root, "mergeCell")
      .map((x) => attr(x, "ref") ?? "")
      .filter(Boolean);
    const conditional = deepFindAll(root, "conditionalFormatting")
      .map((x) => attr(x, "sqref") ?? "")
      .filter(Boolean);

    return { name: sheet, cells: data, merged, conditional, drawings };
  }

  get(sheet: SheetData, addr: string): CellData {
    return sheet.cells[addr] ?? emptyCell();
  }
}

function must(files: Map<string, Buffer>, name: string): Buffer {
  const b = files.get(name);
  if (!b) throw new Error(`xlsx内に ${name} がありません`);
  return b;
}

/** Client/server: list sheet names from workbook bytes. */
export async function listSheetNames(buf: ArrayBuffer | Buffer | Uint8Array): Promise<string[]> {
  const book = await XlsxBook.fromBuffer(buf);
  return book.sheetNames();
}
