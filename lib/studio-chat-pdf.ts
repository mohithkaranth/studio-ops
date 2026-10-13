import {PDFDocument,PDFName,PDFString,rgb,type PDFPage,type PDFFont} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {reportCell,validReportTable,type ReportTable} from './studio-chat-table';
export type PdfChatMessage={role:'user'|'assistant';content:string;sources?:{label:string;href:string}[];table?:ReportTable};
export type PdfExport={mode:'report'|'conversation';messages:PdfChatMessage[];origin:string;question?:string;exportedAt?:Date};

function clean(text:string) {return text.replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');}
export function wrapPdfText(text:string,font:Pick<PDFFont,'widthOfTextAtSize'>,size:number,width:number) {
  const lines:string[]=[];
  for(const paragraph of clean(text).split('\n')) {
    if(!paragraph.trim()) {lines.push('');continue;}
    let line='';
    for(const word of paragraph.trim().split(/\s+/)) {
      const combined=line ? `${line} ${word}` : word;
      if(font.widthOfTextAtSize(combined,size)<=width) {line=combined;continue;}
      if(line) {lines.push(line);line='';}
      for(const character of word) {
        if(line && font.widthOfTextAtSize(line+character,size)>width) {lines.push(line);line='';}
        line+=character;
      }
    }
    if(line) lines.push(line);
  }
  return lines;
}
export function recordUrl(href:string,origin:string) {
  if(!/^\/(acuity\/appointments\/\d+|bank-statements\?|reconciliation\/unsettled\?)/.test(href)) return null;
  const base=new URL(origin);
  if(!['http:','https:'].includes(base.protocol)) return null;
  const url=new URL(href,base.origin);
  return url.origin===base.origin ? url.href : null;
}
export async function createStudioChatPdf(options:PdfExport,fontBytes:Uint8Array) {
  if(!options.messages.length) throw new Error('There is no conversation to export.');
  const doc=await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font=await doc.embedFont(fontBytes,{subset:true});
  const supported=new Set(font.getCharacterSet());
  const printable=(text:string)=>Array.from(clean(text)).map(character=>character==='\n'||supported.has(character.codePointAt(0)!)?character:'?').join('');
  const title=options.mode==='report'?'Studio Report':'Conversation Transcript';
  const exportedAt=options.exportedAt??new Date();
  doc.setTitle(`Tonehouse Studios - ${title}`);doc.setAuthor('Tonehouse Studios');doc.setCreationDate(exportedAt);
  const landscape=options.messages.some(message=>validReportTable(message.table)&&message.table.columns.length>5);
  const width=landscape?841.89:595.28,height=landscape?595.28:841.89,margin=44,bodyWidth=width-margin*2;
  const navy=rgb(.09,.14,.21),ink=rgb(.12,.16,.22),muted=rgb(.4,.44,.5),blue=rgb(.12,.32,.57);
  let page:PDFPage;let y=0;
  function newPage() {
    page=doc.addPage([width,height]);
    page.drawRectangle({x:0,y:height-61,width,height:61,color:navy});
    page.drawText('TONEHOUSE STUDIOS',{x:margin,y:height-38,size:15,font,color:rgb(1,1,1)});
    page.drawText(title,{x:margin,y:height-98,size:21,font,color:ink});
    y=height-126;
  }
  function line(text:string,size:number,color=ink,href?:string) {
    const leading=size*1.5;
    if(y-leading<55) newPage();
    if(text) {
      page.drawText(printable(text),{x:margin,y,size,font,color});
      if(href) page.node.addAnnot(doc.context.register(doc.context.obj({Type:PDFName.of('Annot'),Subtype:PDFName.of('Link'),Rect:[margin,y-3,margin+font.widthOfTextAtSize(printable(text),size),y+size],Border:[0,0,0],A:{Type:PDFName.of('Action'),S:PDFName.of('URI'),URI:PDFString.of(href)}})));
    }
    y-=text ? leading : 7;
  }
  function paragraph(text:string,size=10.5,color=ink,href?:string) {for(const part of wrapPdfText(printable(text),font,size,bodyWidth)) line(part,size,color,href);}
  function section(label:string) {if(y<105)newPage();y-=9;line(label,12,blue);y-=4;}
  function table(report:ReportTable) {
    const padding=7,size=9,leading=13.5;
    const weights=report.columns.map(column=>column.format==='number'?Math.max(13,column.label.length*.7):column.format==='money'?22:Math.min(38,Math.max(16,column.label.length,...report.rows.map(row=>String(row[column.key]??'').split('\n').reduce((max,part)=>Math.max(max,part.length),0)))));
    const total=weights.reduce((sum,weight)=>sum+weight,0);
    const widths=weights.map(weight=>bodyWidth*weight/total);
    const wrap=(value:string,index:number)=>wrapPdfText(printable(value),font,size,widths[index]-padding*2);
    const headers=report.columns.map((column,index)=>wrap(column.label,index));
    const headerHeight=Math.max(...headers.map(lines=>lines.length))*leading+padding*2;
    function cells(lines:string[][],top:number,offset:number,count:number,header=false) {
      let x=margin;
      lines.forEach((parts,index)=>{
        for(let j=0;j<count;j++) {
          const text=parts[offset+j]??'';
          if(!text)continue;
          const right=report.columns[index].format!=='text';
          page.drawText(text,{x:right?x+widths[index]-padding-font.widthOfTextAtSize(text,size):x+padding,y:top-padding-size-j*leading,size,font,color:header?rgb(1,1,1):ink});
        }
        x+=widths[index];
      });
    }
    function header() {
      page.drawRectangle({x:margin,y:y-headerHeight,width:bodyWidth,height:headerHeight,color:navy});
      cells(headers,y,0,Math.max(...headers.map(lines=>lines.length)),true);y-=headerHeight;
    }
    const first=report.rows[0];
    const firstHeight=first?Math.max(...report.columns.map((column,index)=>wrap(reportCell(first[column.key],column.format),index).length))*leading+padding*2:0;
    if(y-headerHeight-Math.min(firstHeight,100)<55)newPage();
    y-=8;header();
    report.rows.forEach((row,rowIndex)=>{
      const lines=report.columns.map((column,index)=>wrap(reportCell(row[column.key],column.format),index));
      const count=Math.max(...lines.map(parts=>parts.length));
      let offset=0;
      if(y-count*leading-padding*2<55&&count*leading+padding*2<height-126-headerHeight-55) {newPage();header();}
      while(offset<count) {
        const available=Math.floor((y-55-padding*2)/leading);
        if(available<1) {newPage();header();continue;}
        const take=Math.min(available,count-offset),rowHeight=take*leading+padding*2;
        page.drawRectangle({x:margin,y:y-rowHeight,width:bodyWidth,height:rowHeight,color:rowIndex%2?rgb(.95,.96,.98):rgb(1,1,1)});
        cells(lines,y,offset,take);y-=rowHeight;
        page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.5,color:rgb(.83,.85,.88)});
        offset+=take;
        if(offset<count){newPage();header();}
      }
    });
    y-=12;
  }
  newPage();
  paragraph(`Exported ${new Intl.DateTimeFormat('en-SG',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Singapore'}).format(exportedAt)} (Singapore)`,9,muted);
  y-=12;
  if(options.mode==='report' && options.question) {section('Requested report');paragraph(options.question);y-=8;}
  let questionNumber=0;
  for(const message of options.messages) {
    if(message.role==='user') questionNumber++;
    section(options.mode==='report'?'Report':message.role==='user'?`Question ${questionNumber}`:'Studio Chat');
    paragraph(message.content);
    if(validReportTable(message.table)) table(message.table);
    const sources=(message.sources??[]).map(source=>({...source,url:recordUrl(source.href,options.origin)})).filter(source=>source.url);
    if(sources.length) {
      const sourceHeight=(source:typeof sources[number])=>wrapPdfText(printable(source.label),font,9,bodyWidth).length*13.5+wrapPdfText(source.url!,font,8,bodyWidth).length*12+5;
      if(y<55+sourceHeight(sources[0])+42)newPage();
      section('Supporting records');
      for(const source of sources) {if(y-sourceHeight(source)<55)newPage();paragraph(source.label,9,blue,source.url!);paragraph(source.url!,8,muted,source.url!);y-=5;}
    }
    y-=10;
  }
  const pages=doc.getPages();
  pages.forEach((item,index)=>{
    item.drawLine({start:{x:margin,y:40},end:{x:width-margin,y:40},thickness:.5,color:rgb(.83,.85,.88)});
    item.drawText('Tonehouse Studios | Studio Chat',{x:margin,y:26,size:8,font,color:muted});
    const label=`${index+1} / ${pages.length}`;
    item.drawText(label,{x:width-margin-font.widthOfTextAtSize(label,8),y:26,size:8,font,color:muted});
  });
  return doc.save();
}
