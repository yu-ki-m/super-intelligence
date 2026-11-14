/* Excel HTML Output — original implementation, no runtime dependencies. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExcelHTMLCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const SCHEMA = 'excel-html-workbook/v1';
  const FORMATS = ['General','@','0','0.00','#,##0','#,##0.00','0%','0.00%','¥#,##0','yyyy/mm/dd'];
  // Excel's own clipboard spelling of each format (measured on Excel 2021 copy output).
  const MSO_FORMAT = {'General':'General','@':'"\\@"','0':'0','0.00':'Fixed','#,##0':'"\\#\\,\\#\\#0"','#,##0.00':'Standard',
    '0%':'0%','0.00%':'Percent','¥#,##0':'"\\0022¥\\0022\\#\\,\\#\\#0"','yyyy/mm/dd':'"yyyy\\/mm\\/dd"'};
  // Japanese Excel defaults: no fill, vertically centred (the Normal style of ja-JP workbooks).
  const DEFAULT = {font:'Yu Gothic',size:11,bold:false,italic:false,underline:false,strike:false,
    color:'#000000',fill:'none',align:'general',valign:'middle',wrap:false,numFmt:'General',
    borderTop:'none',borderRight:'none',borderBottom:'none',borderLeft:'none',indent:0};
  // Border kinds that Excel can represent, with the clipboard CSS Excel itself writes for them.
  const BORDER_XL = {'0.5px solid':'.5pt hairline','1px solid':'.5pt solid','2px solid':'1.0pt solid','3px solid':'1.5pt solid',
    '1px dashed':'.5pt dashed','2px dashed':'1.0pt dashed','1px dotted':'.5pt dotted','3px double':'2.0pt double'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colName = n => { let out=''; for(n++;n>0;n=Math.floor((n-1)/26)) out=String.fromCharCode(65+(n-1)%26)+out; return out; };
  const addr = (r,c) => colName(c)+(r+1);
  function coord(a) { const m=/^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(a); if(!m) throw Error('セル番地が不正です: '+a); return [+m[2]-1,[...m[1].toUpperCase()].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1]; }
  const rect = (a,b=a) => ({r1:Math.min(a[0],b[0]),c1:Math.min(a[1],b[1]),r2:Math.max(a[0],b[0]),c2:Math.max(a[1],b[1])});
  function range(s) { const parts=s.toUpperCase().split(':'); if(parts.length>2) throw Error('範囲が不正です'); return rect(coord(parts[0]),coord(parts[1]||parts[0])); }
  const within=(r,c,q)=>r>=q.r1&&r<=q.r2&&c>=q.c1&&c<=q.c2;
  const overlap=(a,b)=>a.r1<=b.r2&&a.r2>=b.r1&&a.c1<=b.c2&&a.c2>=b.c1;
  const same=(a,b)=>a.r1===b.r1&&a.r2===b.r2&&a.c1===b.c1&&a.c2===b.c2;
  const each=(q,fn)=>{for(let r=q.r1;r<=q.r2;r++)for(let c=q.c1;c<=q.c2;c++)fn(r,c);};
  const get=(s,r,c)=>s.cells[addr(r,c)] || {t:'s',v:''};
  const style=(w,s,cell)=>({...DEFAULT,...w.defaultStyle,...s.defaultStyle,...cell.s});
  function mergeAt(s,r,c){return s.merges.find(m=>within(r,c,m));}
  function expanded(s,q){q={...q};let changed=true;while(changed){changed=false;for(const m of s.merges) if(overlap(q,m)){const n=rect([Math.min(q.r1,m.r1),Math.min(q.c1,m.c1)],[Math.max(q.r2,m.r2),Math.max(q.c2,m.c2)]);if(!same(n,q)){q=n;changed=true;}}}return q;}
  const PICTURE_DATA=/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  // assetsDetached: the editor keeps picture bytes outside the book while editing, so references are not checked then.
  function validate(w,{assetsDetached=false}={}) {
    const fail=m=>{throw Error('ブック形式エラー: '+m);};
    const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
    if(!w||w.schema!==SCHEMA||typeof w.id!=='string'||!w.id||typeof w.revision!=='string'||!w.revision) fail('schema / id / revision');
    if(typeof w.title!=='string'||!Array.isArray(w.sheets)||!w.sheets.length||w.sheets.length>30) fail('title / sheets');
    if(w.assets!==undefined){
      if(!w.assets||typeof w.assets!=='object'||Array.isArray(w.assets)) fail('assets');
      for(const [k,v] of Object.entries(w.assets)) if(!k||typeof v!=='string'||v.length>15e6||!PICTURE_DATA.test(v)) fail('画像データ '+k+'（png / jpeg / gif / webp の data URL）');
    }
    const ids=new Set(), names=new Set();
    const vs = st => { if(!st) return; if(typeof st!=='object'||Array.isArray(st)) fail('style');
      for(const [k,v] of Object.entries(st)) {
        if(!(k in DEFAULT)) fail('未対応の書式 '+k);
        if(k==='color'&&!/^#[\da-f]{6}$/i.test(v)) fail(k);
        if(k==='fill'&&v!=='none'&&!/^#[\da-f]{6}$/i.test(v)) fail(k);
        if(k==='font'&&(typeof v!=='string'||!v||v.length>100||/[<>;{}"\\]/.test(v))) fail('font');
        if(k==='size'&&!(Number.isFinite(v)&&v>=6&&v<=96)) fail('size');
        if(k==='indent'&&!integer(v,0,15)) fail('indent');
        if(['bold','italic','underline','strike','wrap'].includes(k)&&typeof v!=='boolean') fail(k);
        if(k==='align'&&!['general','left','center','right'].includes(v)) fail(k);
        if(k==='valign'&&!['top','middle','bottom'].includes(v)) fail(k);
        if(k==='numFmt'&&!FORMATS.includes(v)) fail('表示形式 '+v);
        if(k.startsWith('border')&&v!=='none'&&!(typeof v==='string'&&/^\S+ \S+ #[\da-f]{6}$/i.test(v)&&BORDER_XL[v.split(' ').slice(0,2).join(' ')])) fail(k+'（Excelで表せる線: '+Object.keys(BORDER_XL).join(' / ')+'）');
      }
    };
    vs(w.defaultStyle);
    for(const s of w.sheets) {
      if(typeof s.id!=='string'||!s.id||ids.has(s.id)) fail('重複したsheet id'); ids.add(s.id);
      if(typeof s.name!=='string'||!s.name||s.name.length>31||/[\\/?*\[\]:]/.test(s.name)||names.has(s.name.toLowerCase())) fail('シート名'); names.add(s.name.toLowerCase());
      if(!integer(s.rows,1,500)||!integer(s.cols,1,100)) fail('上限500行 / 100列');
      if(!s.cells||typeof s.cells!=='object'||Array.isArray(s.cells)||!Array.isArray(s.merges)) fail('cells / merges');
      for(const [key,cell] of Object.entries(s.cells)) {
        const [r,c]=coord(key); if(key!==addr(r,c)||r>=s.rows||c>=s.cols) fail('範囲外のセル '+key);
        if(!cell||!['s','n','b','f'].includes(cell.t)) fail('型 '+key);
        if(cell.t==='s'&&typeof cell.v!=='string'||cell.t==='n'&&!Number.isFinite(cell.v)||cell.t==='b'&&typeof cell.v!=='boolean') fail('値 '+key);
        if(cell.t==='f'&&(typeof cell.f!=='string'||!cell.f.startsWith('='))) fail('数式 '+key);
        if(cell.link && (typeof cell.link!=='string'||!/^https?:\/\//i.test(cell.link))) fail('リンクはhttp(s)のみ');
        vs(cell.s);
      }
      vs(s.defaultStyle);
      for(const [field,maxLen,min,max] of [['colWidths',s.cols,24,800],['rowHeights',s.rows,16,600]]) {
        if(!Array.isArray(s[field])||s[field].length>maxLen||s[field].some(v=>v!==null&&(!Number.isFinite(v)||v<min||v>max))) fail(field);
      }
      for(let i=0;i<s.merges.length;i++){
        const m=s.merges[i]; if(!m||!integer(m.r1,0,s.rows-1)||!integer(m.r2,m.r1,s.rows-1)||!integer(m.c1,0,s.cols-1)||!integer(m.c2,m.c1,s.cols-1)) fail('結合範囲');
        if(s.merges.slice(0,i).some(x=>overlap(x,m))) fail('結合の重複');
        each(m,(r,c)=>{if(r===m.r1&&c===m.c1)return;const cell=get(s,r,c);if(cell.t==='f'||cell.v!==''&&cell.v!==undefined)fail('結合セル内の隠れた値 '+addr(r,c));});
      }
      if(s.freeze&&(!integer(s.freeze.rows,0,s.rows)||!integer(s.freeze.cols,0,s.cols))) fail('固定範囲');
      if(s.freeze&&s.merges.some(m=>m.r1<s.freeze.rows&&m.r2>=s.freeze.rows||m.c1<s.freeze.cols&&m.c2>=s.freeze.cols)) fail('結合をまたぐ固定は未対応');
      if(s.images!==undefined){
        if(!Array.isArray(s.images)||s.images.length>100) fail('images（1シート100枚まで）');
        const seen=new Set();
        for(const p of s.images){
          if(!p||typeof p.id!=='string'||!p.id||seen.has(p.id)||typeof p.asset!=='string'||!p.asset||!integer(p.r,0,s.rows-1)||!integer(p.c,0,s.cols-1)||![p.x,p.y].every(v=>Number.isFinite(v)&&v>=0&&v<=20000)||![p.w,p.h].every(v=>Number.isFinite(v)&&v>=4&&v<=10000)) fail('画像 '+(p&&p.id||''));
          seen.add(p.id);
          if(!assetsDetached&&!(w.assets&&Object.prototype.hasOwnProperty.call(w.assets,p.asset))) fail('画像の中身がありません '+p.id);
        }
      }
    }
    if(!ids.has(w.activeSheet)) fail('activeSheet');
    if(w.view){
      if(typeof w.view!=='object'||Array.isArray(w.view)||!Number.isFinite(w.view.zoom)||w.view.zoom<50||w.view.zoom>200)fail('zoom');
      const s=w.sheets.find(s=>s.id===w.activeSheet),v=w.view;
      if(v.active!==undefined&&(!Array.isArray(v.active)||v.active.length!==2||!integer(v.active[0],0,s.rows-1)||!integer(v.active[1],0,s.cols-1)))fail('view.active');
      if(v.selection!==undefined){const q=v.selection;if(!q||!integer(q.r1,0,s.rows-1)||!integer(q.r2,q.r1,s.rows-1)||!integer(q.c1,0,s.cols-1)||!integer(q.c2,q.c1,s.cols-1))fail('view.selection');}
      for(const key of ['scrollTop','scrollLeft'])if(v[key]!==undefined&&(!Number.isFinite(v[key])||v[key]<0))fail('view.'+key);
    }
    return w;
  }
  const width=(s,c)=>s.colWidths[c]??96;
  const height=(s,r)=>s.rowHeights[r]??22;
  function infer(text, old) {
    text=String(text).replace(/\r\n?/g,'\n'); const st=old?.s ? {s:clone(old.s)} : {};
    if(text.startsWith("'")) return {...st,t:'s',v:text.slice(1)};
    if(old?.s?.numFmt==='@') return {...st,t:'s',v:text};
    if(text.startsWith('=')) return {...st,t:'f',f:text};
    if(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)&&text.replace(/\D/g,'').length<=15&&Number.isFinite(+text)) return {...st,t:'n',v:+text};
    if(/^(TRUE|FALSE)$/.test(text)) return {...st,t:'b',v:text==='TRUE'};
    return {...st,t:'s',v:text};
  }
  const raw=cell=>cell.t==='f'?cell.f:cell.t==='b'?(cell.v?'TRUE':'FALSE'):String(cell.v??'');
  const isErr=x=>typeof x==='string'&&/^#(?:REF!|NAME\?|VALUE!|DIV\/0!|NUM!|CIRC!|N\/A)$/.test(x);
  function calculate(w, sheet, r, c, stack=new Set(), cache=new Map()) {
    const key=sheet.id+'!'+addr(r,c); if(cache.has(key))return cache.get(key); if(stack.has(key))return '#CIRC!';
    const cell=get(sheet,r,c);if(cell.t!=='f')return cell.v??'';
    stack.add(key);let value;
    try {value=evalFormula(cell.f, (a,b)=>{const [rr,cc]=coord(a);if(rr>=sheet.rows||cc>=sheet.cols)return '#REF!';if(!b)return calculate(w,sheet,rr,cc,stack,cache);const q=range(a+':'+b),v=[];if(q.r2>=sheet.rows||q.c2>=sheet.cols)return '#REF!';each(q,(r1,c1)=>v.push(calculate(w,sheet,r1,c1,stack,cache)));return v;});}
    catch(e){value=isErr(e.message)?e.message:'#VALUE!';}
    stack.delete(key); if(typeof value==='number'&&!Number.isFinite(value))value='#NUM!';cache.set(key,value); return value;
  }
  function evalFormula(formula, ref) {
    const pattern=/\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+)|("(?:[^"]|"")*")|(\$?[A-Z]{1,3}\$?[1-9]\d*)|([A-Z_][A-Z_0-9.]*)|(<=|>=|<>|[+\-*/^%&=<>(),:])|(#REF!))/iy;
    const tok=[];let p=1,m;while(p<formula.length){if(!formula.slice(p).trim())break;pattern.lastIndex=p;m=pattern.exec(formula);if(!m)throw Error('#NAME?');tok.push(m[1]?{k:'num',v:+m[1]}:m[2]?{k:'str',v:m[2].slice(1,-1).replace(/""/g,'"')}:m[3]?{k:'ref',v:m[3].toUpperCase()}:m[4]?{k:'id',v:m[4].toUpperCase()}:{k:m[5]||m[6],v:m[5]||m[6]});p=pattern.lastIndex;}
    let i=0;const peek=()=>tok[i]?.k, eat=k=>{if(peek()!==k)throw Error('#VALUE!');return tok[i++];};
    const number=v=>{if(isErr(v))throw Error(v);if(v===''||v===false)return 0;if(v===true)return 1;if(typeof v!=='number')throw Error('#VALUE!');return v;};
    const prec={'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':5};
    function expression(min=0){let left;
      if(peek()==='+'||peek()==='-'){const sign=tok[i++].k;left={op:'unary',sign,x:expression(5)};}
      else if(peek()==='('){i++;left=expression();eat(')');}
      else if(peek()==='num'||peek()==='str'){left={op:'literal',v:tok[i++].v};}
      else if(peek()==='#REF!'){i++;left={op:'literal',v:'#REF!'};}
      else if(peek()==='ref'){const a=tok[i++].v;let b;if(peek()===':'){i++;b=eat('ref').v;}left={op:'ref',a,b};}
      else if(peek()==='id'){const name=tok[i++].v;if(['TRUE','FALSE'].includes(name)&&peek()!=='(')left={op:'literal',v:name==='TRUE'};else {eat('(');const args=[];if(peek()!==')'){args.push(expression());while(peek()===','){i++;args.push(expression());}}eat(')');left={op:'call',name,args};}}
      else throw Error('#VALUE!');
      while(true){if(peek()==='%'){i++;left={op:'percent',x:left};continue;}const op=peek(),pr=prec[op];if(pr===undefined||pr<min)break;i++;left={op:'binary',sign:op,l:left,r:expression(pr+(op==='^'?0:1))};} return left;
    }
    function run(n){
      if(n.op==='literal')return n.v;if(n.op==='ref')return ref(n.a,n.b);
      if(n.op==='unary')return number(run(n.x))*(n.sign==='-'?-1:1);if(n.op==='percent')return number(run(n.x))/100;
      if(n.op==='binary'){const a=run(n.l),b=run(n.r);if(isErr(a))throw Error(a);if(isErr(b))throw Error(b);const aa=typeof a==='string'?a.toLowerCase():a,bb=typeof b==='string'?b.toLowerCase():b;switch(n.sign){case '&':return String(a)+String(b);case '=':return aa===bb;case '<>':return aa!==bb;case '<':return aa<bb;case '>':return aa>bb;case '<=':return aa<=bb;case '>=':return aa>=bb;case '+':return number(a)+number(b);case '-':return number(a)-number(b);case '*':return number(a)*number(b);case '/':if(number(b)===0)throw Error('#DIV/0!');return number(a)/number(b);case '^':return number(a)**number(b);}}
      if(n.name==='IF'){if(n.args.length<2||n.args.length>3)throw Error('#VALUE!');const condition=run(n.args[0]);if(isErr(condition))throw Error(condition);return condition?run(n.args[1]):n.args[2]?run(n.args[2]):false;}
      if(n.name==='IFERROR'){if(n.args.length!==2)throw Error('#VALUE!');let v;try{v=run(n.args[0]);}catch(e){if(isErr(e.message))return run(n.args[1]);throw e;}return isErr(v)||Array.isArray(v)?run(n.args[1]):v;}
      const args=n.args.map(run).flat();for(const v of args)if(isErr(v))throw Error(v);const nums=args.filter(x=>typeof x==='number');
      switch(n.name){case 'SUM':return nums.reduce((a,b)=>a+b,0);case 'AVERAGE':if(!nums.length)throw Error('#DIV/0!');return nums.reduce((a,b)=>a+b,0)/nums.length;case 'MIN':return nums.length?Math.min(...nums):0;case 'MAX':return nums.length?Math.max(...nums):0;case 'COUNT':return nums.length;case 'COUNTA':return args.filter(x=>x!=='').length;case 'ROUNDDOWN':case 'ROUNDUP':{if(args.length!==2)throw Error('#VALUE!');const x=number(args[0]),f=10**Math.trunc(number(args[1])),a=+(Math.abs(x)*f).toPrecision(15);return Math.sign(x)*(n.name==='ROUNDUP'?Math.ceil(a):Math.floor(a))/f;}case 'INT':if(args.length!==1)throw Error('#VALUE!');return Math.floor(+number(args[0]).toPrecision(15));case 'ABS':if(args.length!==1)throw Error('#VALUE!');return Math.abs(number(args[0]));case 'MOD':{if(args.length!==2)throw Error('#VALUE!');const a=number(args[0]),b=number(args[1]);if(b===0)throw Error('#DIV/0!');return a-b*Math.floor(a/b);}case 'AND':case 'OR':{const v=args.filter(x=>typeof x!=='string').map(x=>!!number(x));if(!v.length)throw Error('#VALUE!');return n.name==='AND'?v.every(Boolean):v.some(Boolean);}case 'NOT':if(args.length!==1)throw Error('#VALUE!');return !number(args[0]);case 'ROUND':if(args.length!==2)throw Error('#VALUE!');return Math.sign(number(args[0]))*Math.round((Math.abs(args[0])+Number.EPSILON)*10**number(args[1]))/10**args[1];default:throw Error('#NAME?');}
    }
    const ast=expression();if(i!==tok.length)throw Error('#NAME?');const result=run(ast);return Array.isArray(result)?'#VALUE!':result;
  }
  function display(value,fmt='General') {
    if(isErr(value)||typeof value==='string')return value;if(typeof value==='boolean')return value?'TRUE':'FALSE';
    if(value==null)return ''; if(fmt==='yyyy/mm/dd'){const d=new Date(Date.UTC(1899,11,30)+value*86400000);return isNaN(d)?'#VALUE!':d.toISOString().slice(0,10).replace(/-/g,'/');}
    if(fmt==='General'||fmt==='@')return String(Number(value.toPrecision(15)));
    const percent=fmt.includes('%'),decimals=fmt.includes('.00')?2:0;
    const yen=fmt.startsWith('¥'),neg=yen&&value<0;
    const text=((neg?-value:value)*(percent?100:1)).toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:fmt.includes(',')});
    return (neg?'-':'')+(yen?'¥':'')+text+(percent?'%':'');
  }
  // Horizontal alignment Excel shows for "general": numbers and errors right, booleans centre, text left.
  const generalAlign=value=>typeof value==='number'||isErr(value)?'right':typeof value==='boolean'?'center':'left';
  // Screen CSS. Indent is 1 character (about 9px at 11pt) per level on the aligned side, as in Excel.
  function css(st,value) {
    const align=st.align==='general'?generalAlign(value):st.align,indent=st.indent*9;
    const out={ 'font-family':'"'+st.font.replace(/["\\]/g,'')+'", sans-serif','font-size':st.size+'pt','font-weight':st.bold?'700':'400','font-style':st.italic?'italic':'normal','text-decoration':[(st.underline?'underline':''),(st.strike?'line-through':'')].filter(Boolean).join(' ')||'none','color':st.color,'background-color':st.fill==='none'?'transparent':st.fill,'text-align':align,'vertical-align':st.valign,'white-space':st.wrap?'pre-wrap':'pre','padding-left':(3+(align==='right'?0:indent))+'px','padding-right':(3+(align==='right'?indent:0))+'px' };
    for(const side of ['Top','Right','Bottom','Left']) {const v=st['border'+side];if(v!=='none')out['border-'+side.toLowerCase()]=v;}
    return Object.entries(out).map(([k,v])=>k+':'+v).join(';');
  }
  const JP_FONT=/^(?:yu |ms |biz ud|ud digi|meiryo|hg|noto (?:sans|serif) (?:jp|cjk)|hiragino|source han|ipa|takao)/i;
  const fontCharset=name=>/[^\x00-\x7f]/.test(name)||JP_FONT.test(name)?128:0;
  // Clipboard CSS in the dialect Excel writes and reads (pt borders, mso-* properties, explicit nowrap).
  function xlCss(st,value) {
    const align=st.indent>0&&st.align==='general'?'left':st.align,out=[
      'font-family:"'+st.font.replace(/["\\]/g,'')+'"','mso-font-charset:'+fontCharset(st.font),'font-size:'+st.size+'pt',
      'font-weight:'+(st.bold?700:400),'font-style:'+(st.italic?'italic':'normal'),
      'text-decoration:'+([(st.underline?'underline':''),(st.strike?'line-through':'')].filter(Boolean).join(' ')||'none'),
      'color:'+st.color.toUpperCase(),'text-align:'+align,'vertical-align:'+st.valign,'white-space:'+(st.wrap?'normal':'nowrap'),
      'mso-number-format:'+MSO_FORMAT[st.numFmt]];
    if(st.underline)out.push('text-underline-style:single');
    if(st.fill!=='none')out.push('background:'+st.fill.toUpperCase(),'mso-pattern:black none');
    if(st.indent>0)out.push('mso-char-indent-count:'+st.indent,(align==='right'?'padding-right:':'padding-left:')+(st.indent*15)+'px');
    for(const side of ['Top','Right','Bottom','Left']){const v=st['border'+side];out.push('border-'+side.toLowerCase()+':'+(v==='none'?'none':BORDER_XL[v.split(' ').slice(0,2).join(' ')]+' '+v.split(' ')[2].toUpperCase()));}
    return out.join(';');
  }
  // Strings Excel would turn into a number, date, time, boolean, error or formula when it reads the text.
  function excelWouldConvert(text) {
    const s=String(text).trim();if(s!==String(text)&&s==='')return false;
    if(/^[=+\-@]/.test(s)&&s.length>1||/^'/.test(String(text)))return true;
    if(/^(?:TRUE|FALSE)$/i.test(s)||/^#(?:N\/A|NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|GETTING_DATA)$/i.test(s))return true;
    if(/^[(]?[-+]?[¥$€£]?\s*(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?\s*%?[)]?$/i.test(s))return true;
    if(/^\d{1,4}[/\-.]\d{1,2}(?:[/\-.]\d{1,4})?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(s))return true;
    if(/^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[AP]M?)?$/i.test(s))return true;
    if(/^(?:\d{1,4}年)?\d{1,2}月(?:\d{1,2}日)?$|^\d{1,2}日$|^(?:明治|大正|昭和|平成|令和|[MTSHR])\s*\d{1,2}[年./-]/.test(s))return true;
    if(/^\d{1,2}[\s-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:[\s-]\d{2,4})?$/i.test(s)||/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]\d{1,4}$/i.test(s))return true;
    return false;
  }
  // x:fmla is read relative to the pasted block (even $-references), so rewrite references against the
  // copied range's top-left. Returns null when any reference points outside the copied range.
  function blockFormula(f,q) {
    let outside=false;
    const out=f.replace(/"(?:[^"]|"")*"|\$?[A-Z]{1,3}\$?[1-9]\d*(?![A-Z0-9_(])/gi,m=>{if(m[0]==='"')return m;const p=/^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(m),[r,c]=coord(m);if(!within(r,c,q)){outside=true;return m;}return p[1]+colName(c-q.c1)+p[3]+(r-q.r1+1);});
    return outside?null:out;
  }
  const attr=v=>esc(v).replace(/\n/g,'&#10;').replace(/\r/g,'&#13;').replace(/\t/g,'&#9;');

  /* ---- Reading HTML that Excel (desktop or web) put on the clipboard. Pure functions; the DOM walk is in app.js. ---- */
  const cssUnescape=v=>String(v).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/\\(.)/g,'$1');
  function parseDecls(text) {
    const out={};let buf='',quote='';
    const flush=()=>{const i=buf.indexOf(':');if(i>0)out[buf.slice(0,i).trim().toLowerCase()]=buf.slice(i+1).trim();buf='';};
    for(let i=0;i<String(text||'').length;i++){const ch=text[i];if(quote){buf+=ch;if(ch==='\\'){buf+=text[++i]||'';}else if(ch===quote)quote='';}else if(ch==='"'||ch==="'"){quote=ch;buf+=ch;}else if(ch===';')flush();else buf+=ch;}
    flush();return out;
  }
  // Rules of <style> blocks as [selector, declarations]; Excel writes "td{...}" and ".xl65{...}".
  function parseRules(text) {
    const rules=[],src=String(text||'').replace(/<!--|-->/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
    for(const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g))for(const sel of m[1].split(','))rules.push([sel.trim().toLowerCase(),parseDecls(m[2])]);
    return rules;
  }
  const NAMED={black:'#000000',windowtext:'#000000',white:'#ffffff',window:'#ffffff',red:'#ff0000',green:'#008000',blue:'#0000ff',yellow:'#ffff00',gray:'#808080',grey:'#808080',silver:'#c0c0c0',maroon:'#800000',navy:'#000080',purple:'#800080',teal:'#008080',olive:'#808000',lime:'#00ff00',aqua:'#00ffff',fuchsia:'#ff00ff',orange:'#ffa500'};
  function cssHex(v) {
    v=String(v||'').trim().toLowerCase();if(NAMED[v])return NAMED[v];
    let m=/^#([\da-f]{6})$/.exec(v);if(m)return '#'+m[1];m=/^#([\da-f])([\da-f])([\da-f])$/.exec(v);if(m)return '#'+m[1]+m[1]+m[2]+m[2]+m[3]+m[3];
    m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);if(m)return '#'+m.slice(1,4).map(n=>(+n).toString(16).padStart(2,'0')).join('');
    return null;
  }
  // "Standard", "\0022¥\0022\#\,\#\#0", "yyyy\/mm\/dd" ... -> one of FORMATS, or null when not representable.
  function formatFromMso(v) {
    let f=cssUnescape(String(v||'').trim().replace(/^(['"])([\s\S]*)\1$/,'$2'));
    const named={general:'General',standard:'#,##0.00',fixed:'0.00',percent:'0.00%','short date':'yyyy/mm/dd','\\@':'@'};
    if(named[f.toLowerCase()])return named[f.toLowerCase()];
    f=f.replace(/"([^"]*)"/g,'$1').replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g,'$1').replace(/_.|\*./g,'').replace(/\\(.)/g,'$1').trim();
    if(/^[\\¥￥]#,##0$/.test(f))f='¥#,##0';
    if(/^yyyy\/m{1,2}\/d{1,2}$/i.test(f))f='yyyy/mm/dd';
    return FORMATS.includes(f)?f:null;
  }
  function borderFromCss(v) {
    v=String(v||'').trim().toLowerCase();if(!v||/^none\b|^0(?:pt|px)?\b|hidden/.test(v))return 'none';
    const width=/([\d.]+)(pt|px)/.exec(v),pts=width?(+width[1])*(width[2]==='px'?.75:1):.5,color=cssHex((v.match(/#[\da-f]{3,6}\b|rgba?\([^)]*\)|\b[a-z]+\b(?=\s*$)/g)||[]).pop())||'#000000';
    if(v.includes('hairline'))return '0.5px solid '+color;
    if(v.includes('double'))return '3px double '+color;
    if(/dot-dash|dash|dot-dot/.test(v)&&!/\bdotted\b/.test(v))return (pts>=1?'2px':'1px')+' dashed '+color;
    if(v.includes('dotted'))return '1px dotted '+color;
    return (pts>=1.5?'3px':pts>=1?'2px':'1px')+' solid '+color;
  }
  // Japanese display names Excel writes for fonts this workbook names in English.
  const FONT_ALIAS={'游ゴシック':'Yu Gothic','游明朝':'Yu Mincho','メイリオ':'Meiryo','ＭＳ ゴシック':'MS Gothic','ＭＳ Ｐゴシック':'MS PGothic','ＭＳ 明朝':'MS Mincho','ＭＳ Ｐ明朝':'MS PMincho'};
  // Excel-dialect declarations -> this workbook's style keys (only those the source states).
  function styleFromDecls(d) {
    const st={};
    if(d['font-family']){let f=cssUnescape(d['font-family'].split(',')[0]).replace(/["']/g,'').trim();f=FONT_ALIAS[f]||f;if(f&&f.length<=100&&!/[<>;{}"\\]/.test(f))st.font=f;}
    if(d['font-size']){const m=/([\d.]+)\s*(pt|px)?/.exec(d['font-size']);if(m){const p=+m[1]*(m[2]==='px'?.75:1);if(p>=6&&p<=96)st.size=Math.round(p*2)/2;}}
    if(d['font-weight'])st.bold=/bold|[6-9]00/.test(d['font-weight']);
    if(d['font-style'])st.italic=/italic|oblique/.test(d['font-style']);
    if(d['text-decoration']!==undefined||d['text-underline-style']!==undefined){const t=(d['text-decoration']||'')+' '+(d['text-underline-style']||'');st.underline=/underline|single|double/.test(t)&&!/none\s*$/.test(d['text-underline-style']||'');st.strike=/line-through/.test(t);}
    if(d.color){const c=cssHex(d.color);if(c)st.color=c;}
    const bg=d['background-color']??d.background;if(bg!==undefined)st.fill=cssHex(bg.split(/\s+/)[0])||'none';
    if(d['text-align']){const a=d['text-align'].toLowerCase();st.align=['left','center','right'].includes(a)?a:a==='justify'||a==='fill'?'left':'general';}
    if(d['vertical-align']){const a=d['vertical-align'].toLowerCase();st.valign=a==='top'?'top':a==='bottom'?'bottom':'middle';}
    if(d['white-space'])st.wrap=/normal|pre-wrap|pre-line/.test(d['white-space']);
    if(d['mso-char-indent-count']){const n=parseInt(d['mso-char-indent-count'],10);if(n>=0&&n<=15)st.indent=n;}
    if(d['mso-number-format']){const f=formatFromMso(d['mso-number-format']);st.numFmt=f||'General';}
    const all=d.border!==undefined?borderFromCss(d.border):undefined;
    for(const side of ['Top','Right','Bottom','Left']){const v=d['border-'+side.toLowerCase()];if(v!==undefined)st['border'+side]=borderFromCss(v);else if(all!==undefined)st['border'+side]=all;}
    return st;
  }
  // Number shown with a format ("¥1,200", "12.35%", "2025/12/09") back to its value; null when it is not a number.
  function valueFromDisplay(text,fmt) {
    const s=String(text).trim();if(!s)return null;
    let m=/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
    if(m){const t=Date.UTC(+m[1],+m[2]-1,+m[3]);return Math.round((t-Date.UTC(1899,11,30))/86400000);}
    m=/^([(-])?\s*[¥￥$]?\s*([\d,]*\.?\d+(?:e[-+]?\d+)?)\s*(%)?\)?$/i.exec(s);
    if(!m||fmt==='@')return null;const n=+m[2].replace(/,/g,'');if(!Number.isFinite(n))return null;
    return (m[1]?-1:1)*n/(m[3]?100:1);
  }
  function shiftFormula(f,dr,dc){return f.replace(/"(?:[^"]|"")*"|\$?[A-Z]{1,3}\$?[1-9]\d*/gi,m=>{if(m[0]==='"')return m;const p=/^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(m),[r,c]=coord(m),nr=r+(p[3]?0:dr),nc=c+(p[1]?0:dc);return nr<0||nc<0||nr>=500||nc>=100?'#REF!':p[1]+colName(nc)+p[3]+(nr+1);});}
  function rangeData(w,s,q) {
    q=expanded(s,q);const cells={},merges=s.merges.filter(m=>overlap(m,q)).map(m=>({r1:m.r1-q.r1,r2:m.r2-q.r1,c1:m.c1-q.c1,c2:m.c2-q.c1}));
    each(q,(r,c)=>{const cell=clone(get(s,r,c));cell.s=style(w,s,cell);cells[addr(r-q.r1,c-q.c1)]=cell;});
    return {version:1,source:{book:w.id,sheet:s.id,r:q.r1,c:q.c1},rows:q.r2-q.r1+1,cols:q.c2-q.c1+1,cells,merges,colWidths:Array.from({length:q.c2-q.c1+1},(_,i)=>width(s,q.c1+i)),rowHeights:Array.from({length:q.r2-q.r1+1},(_,i)=>height(s,q.r1+i))};
  }
  const tsvQuote=v=>/[\t\r\n"]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
  // Clipboard HTML in Excel's own dialect. Measured against desktop Excel 2021 (see references/excel-compatibility.md):
  // x:str carries exact text (leading zeros, spaces, line breaks), x:num full-precision numbers, x:fmla formulas
  // whose references stay inside the copied range. Strings Excel would convert are also marked "\@" so that a
  // reader which ignores x:str (possibly Excel for the web) still keeps the text.
  function clipboard(w,s,q) {
    q=expanded(s,q);const data=rangeData(w,s,q),cache=new Map(),plain=[];
    const pt=px=>+(px*.75).toFixed(2),totalW=Array.from({length:q.c2-q.c1+1},(_,i)=>width(s,q.c1+i)).reduce((a,b)=>a+b,0);
    let html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'+
      '<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="ProgId" content="Excel.Sheet"></head><body>'+
      '<table border="0" cellpadding="0" cellspacing="0" width="'+totalW+'" style="border-collapse:collapse;table-layout:fixed;width:'+pt(totalW)+'pt" data-excel-html="'+esc(JSON.stringify(data))+'">';
    for(let c=q.c1;c<=q.c2;c++)html+='<col width="'+width(s,c)+'" style="mso-width-source:userset;width:'+pt(width(s,c))+'pt">';
    for(let r=q.r1;r<=q.r2;r++){
      html+='<tr height="'+height(s,r)+'" style="mso-height-source:userset;height:'+pt(height(s,r))+'pt">';const row=[];
      for(let c=q.c1;c<=q.c2;c++) {
        const merge=mergeAt(s,r,c),hidden=merge&&(r!==merge.r1||c!==merge.c1),cell=get(s,r,c),value=calculate(w,s,r,c,new Set(),cache),st=style(w,s,cell),label=display(value,st.numFmt);row.push(tsvQuote(hidden?'':label));if(hidden)continue;
        const colspan=merge?merge.c2-merge.c1+1:1,rowspan=merge?merge.r2-merge.r1+1:1,cw=Array.from({length:colspan},(_,i)=>width(s,c+i)).reduce((a,b)=>a+b,0);
        let attrs='',cst=st;
        if(cell.t==='f'){const f=blockFormula(cell.f,q);if(f)attrs+=' x:fmla="'+attr(f)+'"';}
        if(typeof value==='number')attrs+=' x:num="'+value+'"';
        else if(typeof value==='boolean')attrs+=' x:bool="'+(value?'TRUE':'FALSE')+'"';
        else if(isErr(value))attrs+=' x:err="'+esc(value)+'"';
        else if(value!==''){attrs+=' x:str="'+attr(value.startsWith("'")?"'"+value:value)+'"';if(st.numFmt!=='@'&&excelWouldConvert(value)&&cell.t!=='f')cst={...st,numFmt:'@'};}
        html+='<td'+(colspan>1?' colspan="'+colspan+'"':'')+(rowspan>1?' rowspan="'+rowspan+'"':'')+' width="'+cw+'" height="'+height(s,r)+'"'+attrs+' style="'+esc(xlCss(cst,value)+';width:'+pt(cw)+'pt;height:'+pt(height(s,r))+'pt')+'">';
        const content=esc(label).replace(/\n/g,'<br style="mso-data-placement:same-cell">');
        html+=(cell.link?'<a href="'+esc(cell.link)+'">'+content+'</a>':content)+'</td>';
      }
      plain.push(row.join('\t'));html+='</tr>';
    }
    html+='</table></body></html>';return {html,text:plain.join('\r\n'),data};
  }
  // Markdown (GFM) table of what the sheet shows: formatted values, the first row as the header.
  // Pipes are escaped and in-cell line breaks become <br>; a merged area keeps its value in its
  // top-left cell; trailing rows and columns without any value are left out; cells are padded
  // (East Asian wide characters count as two) so that the text also lines up in plain editors.
  function markdown(w,s,q) {
    q=expanded(s,q);const cache=new Map(),grid=[];
    for(let r=q.r1;r<=q.r2;r++){
      const row=[];
      for(let c=q.c1;c<=q.c2;c++){
        const merge=mergeAt(s,r,c);if(merge&&(r!==merge.r1||c!==merge.c1)){row.push({text:'',align:''});continue;}
        const cell=get(s,r,c),value=calculate(w,s,r,c,new Set(),cache),st=style(w,s,cell),label=String(display(value,st.numFmt));
        let text=label.replace(/\r\n?/g,'\n').replace(/\|/g,'\\|').replace(/\n/g,'<br>');
        if(cell.link&&text)text='['+text.replace(/[[\]]/g,'\\$&')+']('+cell.link.replace(/[ ()|]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase())+')';
        row.push({text,align:label===''?'':st.align==='general'?generalAlign(value):st.align});
      }
      grid.push(row);
    }
    while(grid.length>1&&grid[grid.length-1].every(x=>!x.text))grid.pop();
    let cols=grid[0].length;while(cols>1&&grid.every(row=>!row[cols-1].text))cols--;for(const row of grid)row.length=cols;
    const wide=ch=>ch.codePointAt(0)>0xffff||/[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch);
    const len=t=>[...t].reduce((n,ch)=>n+(wide(ch)?2:1),0),body=grid.length>1?grid.slice(1):grid;
    const aligns=Array.from({length:cols},(_,c)=>{const seen=new Set(body.map(row=>row[c].align).filter(Boolean));return seen.size===1?[...seen][0]:'left';});
    const widths=Array.from({length:cols},(_,c)=>Math.max(3,...grid.map(row=>len(row[c].text))));
    const pad=(t,c)=>{const gap=widths[c]-len(t);return aligns[c]==='right'?' '.repeat(gap)+t:aligns[c]==='center'?' '.repeat(gap>>1)+t+' '.repeat(gap-(gap>>1)):t+' '.repeat(gap);};
    const line=cells=>'| '+cells.join(' | ')+' |';
    const rule=aligns.map((a,c)=>a==='right'?'-'.repeat(widths[c]-1)+':':a==='center'?':'+'-'.repeat(widths[c]-2)+':':'-'.repeat(widths[c]));
    const text=[line(grid[0].map((x,c)=>pad(x.text,c))),line(rule),...grid.slice(1).map(row=>line(row.map((x,c)=>pad(x.text,c))))].join('\n');
    return {text,rows:grid.length,cols,empty:grid.every(row=>row.every(x=>!x.text))};
  }
  function parseTSV(text) {
    const rows=[];let row=[],cell='',quoted=false;
    text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"'&&(quoted||cell===''))quoted=!quoted;else if(ch==='\t'&&!quoted){row.push(cell);cell='';}else if(ch==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';}else cell+=ch;}
    if(quoted)throw Error('引用符が閉じていない貼り付けデータです');if(cell!==''||row.length||!rows.length){row.push(cell);rows.push(row);}return rows;
  }
  function paste(s,data,r,c,{valuesOnly=false,dimensions=false,relocate=true}={}) {
    if(r+data.rows>s.rows||c+data.cols>s.cols)throw Error('貼り付け先がシート範囲を超えます');
    const q={r1:r,c1:c,r2:r+data.rows-1,c2:c+data.cols-1};
    if(s.merges.some(m=>overlap(q,m)&&!within(m.r1,m.c1,q)||overlap(q,m)&&!within(m.r2,m.c2,q)))throw Error('貼り付け範囲が結合セルの一部に重なります');
    if(valuesOnly&&s.merges.some(m=>overlap(q,m)))throw Error('結合範囲への値のみ貼り付けは、先に結合を解除してください');
    if(!valuesOnly)s.merges=s.merges.filter(m=>!overlap(m,q));
    each({r1:0,c1:0,r2:data.rows-1,c2:data.cols-1},(rr,cc)=>{
      const cell=clone(data.cells[addr(rr,cc)]||{t:'s',v:''});if(cell.t==='f'&&relocate&&data.source)cell.f=shiftFormula(cell.f,r-data.source.r,c-data.source.c);
      if(valuesOnly)cell.s=clone(get(s,r+rr,c+cc).s||{});s.cells[addr(r+rr,c+cc)]=cell;
    });
    if(!valuesOnly)for(const m of data.merges||[])s.merges.push({r1:m.r1+r,r2:m.r2+r,c1:m.c1+c,c2:m.c2+c});
    if(dimensions){data.colWidths?.forEach((v,i)=>{s.colWidths[c+i]=v;});data.rowHeights?.forEach((v,i)=>{s.rowHeights[r+i]=v;});}
    return q;
  }
  return {SCHEMA,FORMATS,MSO_FORMAT,BORDER_XL,DEFAULT,xlCss,excelWouldConvert,blockFormula,generalAlign,
    cssUnescape,parseDecls,parseRules,cssHex,formatFromMso,borderFromCss,styleFromDecls,valueFromDisplay,clone,esc,colName,addr,coord,rect,range,within,overlap,same,each,get,style,mergeAt,expanded,validate,width,height,infer,raw,isErr,calculate,evalFormula,display,css,shiftFormula,rangeData,clipboard,markdown,parseTSV,paste};
});
