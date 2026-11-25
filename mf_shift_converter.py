#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""medicalforce shift importer CSV creator v3.

Designed against an actual 26-sheet clinic workbook (2025.1--2026.12).
Does NOT upload data to medicalforce. Reads OOXML using stdlib so cell style,
phonetic annotations and theme colors can be interpreted without Excel.
All uncertain rows block production CSV output. See README.
"""
from __future__ import annotations
import hashlib, base64, argparse,csv,datetime as dt, json, re, sys, unicodedata, zipfile, posixpath
from pathlib import Path
from collections import Counter
from dataclasses import dataclass
import xml.etree.ElementTree as ET

NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
MF_COLUMNS=['クリニックID ※必須','スタッフID ※必須','日付 ※必須','出勤時間 ※必須','退勤時間 ※必須','休憩開始時間','休憩終了時間']
CLINIC_ID='3e58a4188faa47469738bc31d4fd2537'
REG_COLUMNS=['部署','Excel名','MF登録名','スタッフID','ID確認','対象','空欄の扱い','通常出勤','通常退勤','休憩開始','休憩終了','備考']
OFF_WORDS={'休','休み','有','有休','有給','公休','欠勤','代休','非番','休日','休診','休診日','希','希望休','希望','冬休み','夏休み','夏','冬','夏１','夏２','冬１','冬２','(休)','（休）','育休','振休','特休'}
WORK_WORDS={'出','出勤','勤務','○','〇','◯','●'}
MONTH_RE=re.compile(r'(?<!\d)(20\d{2})\s*[.．年/-]\s*(1[0-2]|0?[1-9])(?:\s*月)?')
COORD=re.compile(r'^([A-Z]+)(\d+)$')
RANGE_RE=re.compile(r'^(\d{1,2}(?:[:.]\d{1,2})?)?-(\d{1,2}(?:[:.]\d{1,2})?)?$')


def cn(c):
    n=0
    for s in c:
        if not 'A'<=s<='Z': raise ValueError('不正な列: '+c)
        n=n*26+ord(s)-64
    return n


def col(n):
    out=''
    while n: n,r=divmod(n-1,26);out=chr(65+r)+out
    return out


def norm(v):
    return re.sub(r'\s+','',unicodedata.normalize('NFKC',str(v or ''))).replace('﨑','崎').replace('兒','児')


def as_text(node,ss):
    typ=node.get('t')
    if typ=='inlineStr':
        return ''.join((t.text or '') for t in node.findall('m:is/m:t',NS)+node.findall('m:is/m:r/m:t',NS))
    vn=node.find('m:v',NS)
    if vn is None:return ''
    if typ=='s':return ss[int(vn.text)]
    return vn.text or ''


def color_to_rgb(node,theme):
    if node is None:return None
    if node.get('rgb'):
        s=node.get('rgb')[-6:]
        return tuple(int(s[i:i+2],16) for i in (0,2,4))
    if node.get('theme') is not None:
        idx=int(node.get('theme'))
        rgb=theme[idx] if idx<len(theme) else None
        if rgb is None:return None
        tint=float(node.get('tint','0'))
        def apply(c):return round(c*(1+tint)) if tint<0 else round(c*(1-tint)+255*tint)
        return tuple(max(0,min(255,apply(c))) for c in rgb)
    if node.get('indexed')=='0': return (0,0,0)
    if node.get('indexed')=='1': return (255,255,255)
    return None


def read_theme(z):
    # Workbook theme indexes: light1,dark1,light2,dark2,accent1...6,hlink,folHlink
    scheme={}
    if 'xl/theme/theme1.xml' not in z.namelist():return [(255,255,255),(0,0,0)]
    xml=ET.fromstring(z.read('xl/theme/theme1.xml'))
    cs=xml.find('.//a:clrScheme',NS)
    if cs is None:return []
    for item in cs:
        x=next(iter(item),None)
        if x is None:continue
        s=x.get('lastClr') or x.get('val')
        if s and len(s)==6:
            try: scheme[item.tag.split('}')[-1]]=tuple(int(s[i:i+2],16) for i in (0,2,4))
            except ValueError:pass
    return [scheme.get(n) for n in ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink']]


@dataclass
class Cell:
    value:str=''
    color:str=''
    gray:bool=False
    exists:bool=False
    formula:bool=False
    fill_id:int=0

class Xlsx:
    def __init__(self,path):
        self.path=Path(path)
        with zipfile.ZipFile(self.path) as z:
            self.zfiles={name:z.read(name) for name in z.namelist() if name.startswith(('xl/','docProps/'))}
        self.sheets={}
        book=ET.fromstring(self.zfiles['xl/workbook.xml'])
        relationships=ET.fromstring(self.zfiles['xl/_rels/workbook.xml.rels'])
        urls={r.get('Id'):r.get('Target') for r in relationships}
        for s in book.findall('m:sheets/m:sheet',NS):
            name=s.get('name');target=urls[s.get('{'+NS['r']+'}id')]
            xmlpath=target.lstrip('/') if target.startswith('/') else ('xl/'+target if not target.startswith('xl/') else target)
            if xmlpath not in self.zfiles:raise ValueError(f'シートXML不明: {xmlpath}')
            self.sheets[name]=xmlpath
        ss=[]
        if 'xl/sharedStrings.xml' in self.zfiles:
            for si in ET.fromstring(self.zfiles['xl/sharedStrings.xml']).findall('m:si',NS):
                # Critical: m:rPh/m:t is ruby pronunciation, not displayed text.
                ss.append(''.join((t.text or '') for t in si.findall('m:t',NS)+si.findall('m:r/m:t',NS)))
        self.ss=ss
        with zipfile.ZipFile(self.path) as z:theme=read_theme(z)
        st=ET.fromstring(self.zfiles['xl/styles.xml'])
        fills=[]
        for f in st.findall('m:fills/m:fill',NS):
            pattern=f.find('m:patternFill',NS)
            rgb=color_to_rgb(pattern.find('m:fgColor',NS),theme) if pattern is not None and pattern.get('patternType')=='solid' else None
            fills.append(rgb)
        self.fills=fills
        self.fill_by_style=[int(x.get('fillId','0')) for x in st.findall('m:cellXfs/m:xf',NS)]

    def read(self,sheet):
        if sheet not in self.sheets:raise ValueError(f'存在しないシート「{sheet}」。候補：{list(self.sheets)}')
        root=ET.fromstring(self.zfiles[self.sheets[sheet]])
        data={}
        for node in root.findall('.//m:sheetData/m:row/m:c',NS):
            a=node.get('r');sty=int(node.get('s','0'))
            fi=self.fill_by_style[sty] if sty<len(self.fill_by_style) else 0
            rgb=self.fills[fi] if fi<len(self.fills) else None
            hexcolor='#'+''.join(f'{n:02X}' for n in rgb) if rgb else ''
            gray=bool(rgb and max(rgb)-min(rgb)<35 and sum(rgb)/3<215)
            data[a]=Cell(as_text(node,self.ss).strip(),hexcolor,gray,True,node.find('m:f',NS) is not None,fi)
        drawings=[]
        xmlfile=self.sheets[sheet]
        relfile=posixpath.join(posixpath.dirname(xmlfile),'_rels',posixpath.basename(xmlfile)+'.rels')
        if relfile in self.zfiles:
            relroot=ET.fromstring(self.zfiles[relfile])
            relmap={r.get('Id'):r.get('Target') for r in relroot}
            for dr in root.findall('m:drawing',NS):
                target=relmap.get(dr.get('{'+NS['r']+'}id'))
                if not target:continue
                fp=target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join(posixpath.dirname(xmlfile),target))
                if fp not in self.zfiles:continue
                drroot=ET.fromstring(self.zfiles[fp])
                for anchor in drroot:
                    loc=anchor.find('xdr:from',{'xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'})
                    if loc is None:continue
                    txt=''.join(x.text or '' for x in anchor.findall('.//a:t',NS))
                    row=loc.findtext('xdr:row',namespaces={'xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'})
                    c=loc.findtext('xdr:col',namespaces={'xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'})
                    if txt and row is not None and c is not None:
                        drawings.append({'文字':txt,'行':int(row)+1,'列':col(int(c)+1)})
        return Sheet(sheet,data,
              [x.get('ref','') for x in root.findall('m:mergeCells/m:mergeCell',NS)],
              [x.get('sqref','') for x in root.findall('m:conditionalFormatting',NS)],
              drawings)

class Sheet:
    def __init__(self,name,cells,merged,conditional,drawings):
        self.name=name;self.cells=cells;self.merged=merged;self.conditional=conditional;self.drawings=drawings
    def get(self,addr):return self.cells.get(addr,Cell())


def parse_day(v):
    m=re.fullmatch(r'\s*(\d{1,2})(?:\.0+)?(?:祝|[（(]祝[)）])?\s*',str(v))
    if not m:return None
    d=int(m.group(1));return d if 1<=d<=31 else None


def month_for(sheetname):
    match=MONTH_RE.search(sheetname.strip())
    return (int(match.group(1)),int(match.group(2))) if match else None


def monthdays(y,m):
    begin=dt.date(y,m,1)
    end=dt.date(y+1,1,1) if m==12 else dt.date(y,m+1,1)
    return (end-begin).days


def locate_layout(sh,ym):
    y,m=ym;last=monthdays(y,m)
    matches=[]
    for r in range(1,16):
        if [parse_day(sh.get('A'+str(r+k)).value) for k in range(3)]==[1,2,3]:matches.append(r)
    if len(matches)!=1:raise ValueError(f'{sh.name}: 日付開始行を特定できません {matches}')
    first=matches[0]
    for d in range(1,last+1):
        got=parse_day(sh.get('A'+str(first+d-1)).value)
        if got!=d:raise ValueError(f'{sh.name}: A{first+d-1}の日付が不整合: {got},期待{d}')
    return first,first-1,last


def readcsv(path):
    raw=Path(path).read_bytes()
    for enc in ('utf-8-sig','cp932'):
        try:return list(csv.DictReader(raw.decode(enc).splitlines()))
        except UnicodeDecodeError:continue
    raise ValueError(f'CSVの文字コードを判定できません: {path}')


def registry_load(path):
    rows=readcsv(path)
    if not rows or not set(REG_COLUMNS).issubset(rows[0]):raise ValueError('staff_registry.csvのヘッダーが不足')
    return [{k:(r.get(k) or '').strip() for k in REG_COLUMNS} for r in rows]


def template_check(path):
    b=Path(path).read_bytes()
    for enc in ('cp932','utf-8-sig'):
        try:
            header=next(csv.reader(b.decode(enc).splitlines()))
            break
        except UnicodeDecodeError:continue
    if header!=MF_COLUMNS:raise ValueError(f'MFテンプレートの列が一致しません: {header}')


def identify_staff(sh,first,headerrow,last,reg,master):
    # Use only actual employee names in row 4; mirror date columns are blank.
    names = []
    department = ''
    for n in sorted(cn(m.group(1)) for addr in sh.cells
                    if (m := COORD.fullmatch(addr)) and int(m.group(2)) == headerrow and cn(m.group(1)) >= 3):
        c = col(n)
        department = sh.get(f'{c}{headerrow-1}').value.strip() or department
        display = sh.get(f'{c}{headerrow}').value.strip()
        if display and not display.isdigit() and display not in {'日','曜日','Ns','Cs','外科','AGA','広報','事務','皮膚科','経理'}:
            names.append((c, display, department))
    assigned=[];used=set()
    master_names={x['スタッフID']:x['スタッフ名'] for x in master}
    for c,display,department in names:
        normalized=norm(display)
        matches=[r for r in reg if norm(r['Excel名'])==normalized]
        if len(matches)>1:
            matches=[r for r in matches if norm(r['部署'])==norm(department)]
        if len(matches)==1:
            rule=dict(matches[0]);match_status='登録済み対応表'
        else:
            role=[]
            for x in master:
                n=norm(x['スタッフ名'])
                # raw full names, excluding prefixed pseudo-staff and suffix-2 duplicate aliases
                if n.startswith(normalized) and not n.startswith('【') and not re.search(r'\d$',n):role.append(x)
            if len(role)==1:
                candidate=role[0]
                rule={k:'' for k in REG_COLUMNS};rule.update({'Excel名':display,'MF登録名':candidate['スタッフ名'],'スタッフID':candidate['スタッフID'],'ID確認':'要確認','対象':'1','空欄の扱い':'要確認'})
                match_status='新規・自動ID候補（未承認）'
            else:
                rule={k:'' for k in REG_COLUMNS};rule.update({'Excel名':display,'ID確認':'未照合','対象':'1','空欄の扱い':'要確認'})
                match_status='ID候補複数またはなし'
        if rule['スタッフID'] and master_names.get(rule['スタッフID'])!=rule['MF登録名']:
            match_status+=' / マスターID氏名不一致';rule['ID確認']='要確認'
        if rule['スタッフID'] in used and rule['スタッフID']:
            match_status+=' / 重複スタッフID';rule['ID確認']='要確認'
        used.add(rule['スタッフID'])
        assigned.append((c,display,rule,match_status))
    return assigned


def time_norm(s):
    s=unicodedata.normalize('NFKC',str(s or '')).strip()
    if not s:return ''
    m=re.fullmatch(r'(\d{1,2})(?:(:)(\d{1,2})|\.(\d+))?',s)
    if not m:raise ValueError(f'時刻表記が未対応: {s!r}')
    h=int(m.group(1)); mi=int(m.group(3) or 0)
    if m.group(4):
        frac=float('0.'+m.group(4));mi=round(frac*60)
    if not (0<=h<=23 and 0<=mi<60):raise ValueError(f'時刻が範囲外: {s!r}')
    return f'{h:02d}:{mi:02d}'


def minutes(s):
    h,m=map(int,s.split(':'));return h*60+m


def clean_time_expr(raw):
    x=unicodedata.normalize('NFKC',raw).strip()
    for symbol in ('−','ー','‐','‑','–','—','ｰ','~','〜','～','－'):
        x=x.replace(symbol,'-')
    return re.sub(r'\s+','',x)


def decode_time(raw,rule,allow_decimal):
    # Work time explicit 10-19 or -18; optionally with /13-14 break.
    raw=clean_time_expr(raw)
    pieces=raw.split('/')
    if len(pieces)>2:raise ValueError('休憩範囲が複数')
    main=pieces[0]
    if main in WORK_WORDS or main=='WORK':start=rule['通常出勤'];end=rule['通常退勤']
    else:
        m=RANGE_RE.fullmatch(main)
        if m and (m.group(1) or m.group(2)):
            if '.' in main and not allow_decimal:raise ValueError('17.5形式は確認設定が必要')
            start=m.group(1) or rule['通常出勤'];end=m.group(2) or rule['通常退勤']
        elif re.fullmatch(r'\d{1,2}(?:\.\d+)?',main) and allow_decimal:
            start=rule['通常出勤'];end=main
        else:raise ValueError(f'勤務文字を解釈できません: {raw!r}')
    start=time_norm(start);end=time_norm(end)
    if not start or not end:raise ValueError('出勤/退勤時刻が設定されていません')
    bs=time_norm(rule['休憩開始']);be=time_norm(rule['休憩終了'])
    if len(pieces)==2:
        m=RANGE_RE.fullmatch(pieces[1])
        if not m or not m.group(1) or not m.group(2):raise ValueError('休憩時間の形式が不正')
        bs=time_norm(m.group(1));be=time_norm(m.group(2))
    if bool(bs)!=bool(be):raise ValueError('休憩は開始・終了をセットで入力')
    if minutes(start)>=minutes(end):raise ValueError('日跨ぎ勤務/終了以前の時刻は未対応')
    if bs and not (minutes(start)<=minutes(bs)<minutes(be)<=minutes(end)):
        raise ValueError('休憩が勤務時間外')
    return [start,end,bs,be]


def interpret(cell,rule,cfg,fullcolblank=False):
    txt=cell.value.strip(); n=clean_time_expr(txt);t=norm(txt)
    if cell.formula and not txt:return ('要確認','数式の値が保存されていません',None)
    if fullcolblank:return ('要確認','月全体に勤務・休みの区別がない列。対象スタッフか確認',None)
    # Unambiguously off-coded strings, including off-codes even with gray style
    if t in {norm(x) for x in OFF_WORDS} or (t.startswith('有') and t[1:].isdigit()) or (t.startswith('夏') and t[1:].isdigit()):
        return ('非勤務','休暇・希望休などの表示',None)
    # explicit time has priority over shade (there are -19 entries on gray in real workbook)
    is_time=bool(RANGE_RE.fullmatch(n)) or bool(re.fullmatch(r'\d{1,2}(?:\.\d+)?',n))
    if is_time or ('/' in n and RANGE_RE.fullmatch(n.split('/')[0])) or t in {norm(x) for x in WORK_WORDS}:
        try:return ('勤務','時刻/勤務記号による指定',decode_time(txt,rule,cfg.get('decimal_hours_verified',False)))
        except ValueError as ex:return ('要確認',str(ex),None)
    if txt:
        code_rules=cfg.get('text_codes',{})
        if txt in code_rules:
            value=code_rules[txt]
            if value=='off':return ('非勤務','承認済み文字ルール',None)
            if value=='work':
                try:return ('勤務','承認済み文字ルール',decode_time('WORK',rule,cfg.get('decimal_hours_verified',False)))
                except ValueError as ex:return ('要確認',str(ex),None)
        return ('要確認',f'未定義の記号: {txt!r}',None)
    if cell.gray:
        if cfg.get('gray_means_off_verified',False):return ('非勤務','承認済み: 灰色は休み',None)
        return ('要確認','灰色の意味が未承認',None)
    # Colored accents (not gray) require manual review, not implicit attendance.
    if cell.color:
        rgb=tuple(int(cell.color[k:k+2],16) for k in (1,3,5))
        if min(rgb)<230:
            return ('要確認','灰色以外の背景色の意味が未定義: '+cell.color,None)
    blank=rule['空欄の扱い']
    if blank=='勤務':
        try:return ('勤務','承認済み: 白い空欄を勤務と解釈',decode_time('WORK',rule,cfg.get('decimal_hours_verified',False)))
        except ValueError as ex:return ('要確認',str(ex),None)
    if blank=='無視':return ('非勤務','承認済み: 白い空欄は除外',None)
    return ('要確認','白い空欄の意味が未設定',None)


def write_csv(path,header,rows,encoding='utf-8-sig'):
    with Path(path).open('w',encoding=encoding,newline='') as f:
        writer=csv.writer(f);writer.writerow(header);writer.writerows(rows)


def sheet_report(xlsx):
    result=[]
    for name in xlsx.sheets:
        ym=month_for(name)
        result.append({'シート名':name,'対象年月':f'{ym[0]:04d}-{ym[1]:02d}' if ym else '', '種類':'月別シフト' if ym and name.strip().startswith('20') else 'その他'})
    return result


def convert(inp,out,cfg,template,registry,master,sheetname=None):
    cfg=json.loads(Path(cfg).read_text(encoding='utf-8'))
    if cfg['clinic_id']!=CLINIC_ID:raise ValueError('クリニックIDを変更しないでください')
    template_check(template)
    xlsx=Xlsx(inp)
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    write_csv(out/'シート一覧.csv',['シート名','対象年月','種類'],[(r['シート名'],r['対象年月'],r['種類']) for r in sheet_report(xlsx)])
    name=sheetname or cfg.get('sheet_name')
    if not name:
        names=[name for name in xlsx.sheets if month_for(name)]
        if len(names)!=1:raise ValueError('月別シートが複数あります。--sheet 2026.11 のように対象月を必ず指定してください。シート一覧.csvを確認。')
        name=names[0]
    if name not in xlsx.sheets:
        fallback=[n for n in xlsx.sheets if n.strip()==name.strip()]
        if len(fallback)==1:name=fallback[0]
    if name not in xlsx.sheets:raise ValueError('指定シートが存在しません: '+name)
    ym=month_for(name)
    if not ym:raise ValueError('年月を識別できないシートです: '+name)
    sh=xlsx.read(name)
    title_month=month_for(sh.get('A1').value)
    if title_month and title_month!=ym:
        raise ValueError(f'シート名 {name} の年月 {ym} と表題A1の年月 {title_month} が異なります。データの年月を確認してください。')
    first,header,last=locate_layout(sh,ym)
    reg=registry_load(registry);masterrows=readcsv(master)
    assigned=identify_staff(sh,first,header,last,reg,masterrows)
    if not assigned:raise ValueError('スタッフ列を検出できません。確認をお願いします。')
    merged_overlay={}
    merged_report=[]
    active_cols={c for c,_,_,_ in assigned}
    for region in sh.merged:
        parts=region.split(':')
        if len(parts)!=2:continue
        left,right=parts
        a=COORD.fullmatch(left);b=COORD.fullmatch(right)
        if not a or not b:continue
        leftnum,top=cn(a.group(1)),int(a.group(2))
        rightnum,bottom=cn(b.group(1)),int(b.group(2))
        if bottom<first or top>=first+last:continue
        t=sh.get(left).value.strip()
        if not t:continue
        merged_report.append({'範囲':region,'文字':t,'開始日':top-first+1})
        for r in range(max(first,top),min(first+last,bottom+1)):
            for n in range(leftnum,rightnum+1):
                cc=col(n)
                if cc in active_cols:merged_overlay[(cc,r)]=(region,t)
    issues=[];records=[];review=[];match_rows=[];statuses=Counter();excluded=[]
    if sh.conditional:issues.append(('全体','', '条件付き書式があります。表示色とセル色が異なる可能性があります: '+str(sh.conditional)))
    drawing_decisions=cfg.get('drawing_day_decisions',{})
    whole_clinic_closed=set()
    drawing_report=[]
    for dr in sh.drawings:
        day=dr['行']-first+1
        if not (1<=day<=last):continue
        dr['日付']=f'{ym[0]:04d}-{ym[1]:02d}-{day:02d}'
        drawing_report.append(dr)
        action=drawing_decisions.get(dr['日付'],'')
        if action=='off':whole_clinic_closed.add(day)
        elif action=='note_only':pass
        else:issues.append(('図形',dr['列']+str(dr['行']),f'{day}日の図形「{dr["文字"]}」が未確認。drawing_day_decisionsに off / note_only を設定'))
    editor_staff = []
    for c,display,rule,ms in assigned:
        sid=rule['スタッフID'];status=rule['ID確認']
        match_rows.append((c,display,rule['部署'],rule['MF登録名'],sid,status,ms,rule['空欄の扱い'],rule['通常出勤'],rule['通常退勤'],rule['対象']))
        if rule['対象']!='1':
            excluded.append(f'{c}列 {display}（レジストリで対象=0）');continue
        days = []
        editor_staff.append(dict(name=display, column=c, id=sid if status=='確認済' else '', candidate=sid, days=days))
        if not sid:issues.append(('氏名',c,'スタッフIDがありません: '+display))
        if status!='確認済':issues.append(('氏名',c,'スタッフID未確認: '+display+' / '+status+' / '+ms))
        # Entirely blank and white columns typically correspond to old staff slots; never silently import.
        colcells=[sh.get(f'{c}{first+d}') for d in range(last)]
        indicator=sum(bool(x.value.strip()) or x.gray for x in colcells)
        sparse=(indicator<=1)
        # Sparse cells are okay only when the staff mapping and empty-cell rule were explicitly approved.
        emptycol=sparse and not (status=='確認済' and rule['空欄の扱い'] in {'勤務','無視'})
        if emptycol:issues.append(('氏名',c,'勤務/休みの記入が0～1件のみ。未使用列の可能性あり、対象可否を確認: '+display))
        for d,cell in enumerate(colcells,1):
            dat=dt.date(*ym,d);addr=f'{c}{first+d-1}'
            merged=merged_overlay.get((c,first+d-1))
            if merged and merged[1] not in cfg.get('merged_cell_codes',{}):
                outcome,reason,times=('要確認',f'結合セル {merged[0]} の文字 {merged[1]!r} は勤務/休日の判定未設定',None)
            elif merged and cfg['merged_cell_codes'][merged[1]]=='off':
                outcome,reason,times=('非勤務',f'承認済み結合セル {merged[1]!r} は非勤務',None)
            elif merged and cfg['merged_cell_codes'][merged[1]]=='work':
                try:
                    times=decode_time('WORK',rule,cfg.get('decimal_hours_verified',False))
                    outcome,reason=('勤務',f'承認済み結合セル {merged[1]!r} は通常勤務')
                except ValueError as e:
                    outcome,reason,times=('要確認',str(e),None)
            elif d in whole_clinic_closed:
                outcome,reason,times=('非勤務','ユーザー承認済: 図形で示された全院休診日',None)
                if cell.value.strip() and norm(cell.value) not in {norm(x) for x in OFF_WORDS}:
                    issues.append((dat.isoformat(),addr,'全院休診日に文字が入っています: '+repr(cell.value)))
            else:
                outcome,reason,times=interpret(cell,rule,cfg,emptycol)
            proposed = times
            if not proposed and outcome!='非勤務':
                defaults = dict(rule)
                defaults['通常出勤'] = defaults['通常出勤'] or '10:00'
                defaults['通常退勤'] = defaults['通常退勤'] or '19:00'
                try:
                    proposed = decode_time(cell.value or 'WORK', defaults, True)
                except ValueError:
                    proposed = None
            notices = [dr['文字'] for dr in drawing_report if dr['日付']==dat.isoformat()
                       and drawing_decisions.get(dr['日付']) not in ('note_only','off')]
            if sh.conditional:
                notices.append('条件付き書式あり')
            days.append(dict(date=dat.strftime('%Y/%m/%d'), addr=addr, raw=cell.value, color=cell.color,
                             status='要確認' if notices else outcome,
                             reason=' / '.join([reason, *notices]), times=proposed))

            if outcome=='勤務' and status!='確認済':
                outcome='要確認';reason='スタッフIDが未確認 / '+reason;times=None
            statuses[outcome]+=1
            if outcome=='要確認':issues.append((dat.isoformat(),addr,display+': '+reason))
            elif outcome=='勤務':
                records.append([CLINIC_ID,sid,dat.strftime('%Y/%m/%d'),*times])
            review.append([dat.isoformat(),addr,c,display,cell.value,cell.color,cell.fill_id,'灰色' if cell.gray else '白系',outcome,reason,*(times or ['','','',''])])
    if not cfg.get('work_rules_verified',False):issues.append(('全体','','勤務判定ルール全体が未承認（config.json work_rules_verified=false）'))
    write_csv(out/'スタッフ照合.csv',['列','Excel表示名','部署（設定）','MF登録名','スタッフID','ID確認','照合方法','空欄方針','通常出勤','通常退勤','対象'],match_rows)
    write_csv(out/'セル別判定.csv',['日付','セル番地','列','スタッフ名','文字','色（RGB換算）','塗りスタイルID','色区分','判定','理由','出勤','退勤','休憩開始','休憩終了'],review)
    write_csv(out/'確認事項.csv',['日付/対象','セル/列','確認内容'],issues)
    grouped={}
    for when,addr,msg in issues:
        # Repeated blank-cell warnings appear once per staff and issue type.
        normalized=re.sub(r'出勤/退勤時刻が設定されていません','通常出勤/退勤が未設定',msg)
        staffpart=addr.rstrip('0123456789') if addr else ''
        key=(staffpart,normalized)
        if key not in grouped:grouped[key]=[0,[]]
        grouped[key][0]+=1
        if len(grouped[key][1])<4:grouped[key][1].append(addr or when)
    write_csv(out/'確認事項_集約.csv',['スタッフ列','確認内容','該当件数','代表セル'],[ [k[0],k[1],v[0],' / '.join(v[1])] for k,v in grouped.items()])
    # Candidate registry contains every newly encountered name; user can approve and reuse.
    proposed=list(reg)
    existing={(norm(r['Excel名']),norm(r['部署'])) for r in proposed}
    for c,display,rule,ms in assigned:
        if ms.startswith('新規') or ms.startswith('ID候補'):
            key=(norm(display),norm(rule['部署']))
            if key not in existing:
                proposed.append(dict(rule)); existing.add(key)
    write_csv(out/'スタッフID対応表_追記候補.csv',REG_COLUMNS,[[r.get(k,'') for k in REG_COLUMNS] for r in proposed])
    # Draft deliberately uses DIFFERENT header to prevent accidental MF upload.
    write_csv(out/'勤務候補_確認用.csv',['クリニックID','スタッフID','日付','出勤','退勤','休憩開始','休憩終了'],records)
    prod=out/'medicalforce_import.csv'
    if prod.exists():prod.unlink()
    eligible=not issues and bool(records)
    if eligible:write_csv(prod,MF_COLUMNS,records,'cp932')
    header_bytes = (','.join(MF_COLUMNS)+'\r\n').encode('cp932')
    payload = dict(month=f'{ym[0]:04d}-{ym[1]:02d}', clinic=CLINIC_ID, staff=editor_staff,
                   master=masterrows, header=base64.b64encode(header_bytes).decode('ascii'))
    page = Path(__file__).with_name('monthly_review.html').read_text(encoding='utf-8')
    data = json.dumps(payload, ensure_ascii=False).replace('<', r'\u003c')
    (out/'月次シフト確認.html').write_text(page.replace('MONTH_FINGERPRINT', hashlib.sha256(data.encode()).hexdigest()).replace('/*MONTH_DATA*/null',data), encoding='utf-8')
    report={'入力':str(inp),'シート':name,'年月':f'{ym[0]}-{ym[1]:02d}',
            '日付範囲':f'{first}行目から{last}日分','スタッフ列':len(assigned),'意図的な除外スタッフ':excluded,
            'MF登録候補数':len(records),'要確認件数':len(issues),'セル判定件数':len(review),
            '判定内訳':dict(statuses),'図形の解析結果':drawing_report,'結合セル注記':merged_report,'MF用CSV作成':eligible,
            '補足':'ID・勤務時間・白灰判定を承認して初めて本番CSV作成。シート別のスタッフ移動は自動検出。'}
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if eligible else 2


def main():
    p=argparse.ArgumentParser(description='実Excel対応版: Excel→medicalforceシフトCSV (v3)')
    p.add_argument('--input',type=Path,required=True)
    p.add_argument('--sheet',help='対象の月別シート名 例: 2026.11 / 2026.8')
    p.add_argument('--config',type=Path,default=Path(__file__).with_name('config.json'))
    p.add_argument('--registry',type=Path,default=Path(__file__).with_name('staff_registry.csv'))
    p.add_argument('--master',type=Path,default=Path(__file__).with_name('mf_staff_master.csv'))
    p.add_argument('--template',type=Path,default=Path(__file__).with_name('mf_shift_template.csv'))
    p.add_argument('--out',type=Path,default=Path(__file__).with_name('output'))
    a=p.parse_args()
    try:sys.exit(convert(a.input,a.out,a.config,a.template,a.registry,a.master,a.sheet))
    except (ValueError,IndexError,KeyError,FileNotFoundError,zipfile.BadZipFile,ET.ParseError) as e:
        print('変換停止:',e,file=sys.stderr);sys.exit(1)

if __name__=='__main__':main()
