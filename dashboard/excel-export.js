import ExcelJS from 'exceljs';
import {steps} from '../Brief/schema.js';
const statuses={new:'جديد',reviewing:'قيد المراجعة',reviewed:'تمت المراجعة',archived:'مؤرشف'};
// Always assign strings: customer input must never become an Excel formula or hyperlink.
const text=value=>Array.isArray(value)?value.join('، '):String(value??'');
export async function makeWorkbook(rows){
 const book=new ExcelJS.Workbook();book.creator='أحمد الرويني';
 const sheet=book.addWorksheet('البريفات',{views:[{state:'frozen',ySplit:1,rightToLeft:true}],properties:{defaultRowHeight:38}});
 const fields=steps.flatMap(s=>s.fields).filter(([k])=>!['brand','contactName','phone','email'].includes(k));
 const columns=[['id','رقم البريف',38],['brand','النشاط',30],['contact_name','المسؤول',25],['phone','واتساب',24],['email','البريد الإلكتروني',32],['submitted_at','وقت الإرسال UTC',28],['status','الحالة',20],['notes','ملاحظاتي',55],...fields.map(([key,label])=>['answer:'+key,label.replace(/\s*\*$/,''),45])];
 sheet.columns=columns.map(([key,header,width])=>({key,header,width}));
 for(const row of rows){const data={};for(const [key] of columns)data[key]=text(key.startsWith('answer:')?row.answers[key.slice(7)]:key==='status'?statuses[row.status]||row.status:row[key]);sheet.addRow(data);}
 sheet.eachRow((row,index)=>{row.eachCell({includeEmpty:true},cell=>{cell.font={name:'Arial',size:11,color:{argb:index===1?'FFFFFFFF':'FF172033'},bold:index===1};cell.alignment={horizontal:'right',vertical:'top',wrapText:true,readingOrder:'rtl'};cell.numFmt='@';cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:index===1?'FF0B1F3A':index%2?'FFFFFAF1':'FFFFFFFF'}};});if(index===1)row.height=62;});
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,rows.length+1),column:columns.length}};
 return book.xlsx.writeBuffer();
}
