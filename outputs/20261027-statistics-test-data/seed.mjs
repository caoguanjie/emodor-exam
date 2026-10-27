import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { GradingService } = require('./dist/modules/exams/grading.service');
const conn = await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USERNAME||'root',password:process.env.DB_PASSWORD??'',database:process.env.DB_DATABASE});
const title = '【统计测试】考试分析功能验收-20261027';
const manifest = {title, categoryId:null, paperId:null, releaseId:null, userIds:[], questionIds:[], versionIds:[], assignmentIds:[], recordIds:[]};
const J = JSON.stringify;
async function insert(table, row) {
  const keys = Object.keys(row);
  const [result] = await conn.execute(`INSERT INTO \`${table}\` (${keys.map(k=>'`'+k+'`').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`, Object.values(row));
  return String(result.insertId);
}
const doc = text => ({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
try {
  await conn.beginTransaction();
  const [existing] = await conn.execute('SELECT id FROM exam_paper WHERE title=?',[title]);
  assert.equal(existing.length,0,'测试数据已存在，停止，避免重复插入');
  const [[admin]] = await conn.query("SELECT id FROM sys_user WHERE role='super_admin' AND status=1 ORDER BY id LIMIT 1");
  assert.ok(admin,'需要有效管理员作为测试数据创建人');
  const actor = String(admin.id);
  manifest.categoryId = await insert('training_category',{name:'统计测试-20261027',description:'仅用于考试统计验收的合成数据',status:1,created_by:actor});
  const hash = await bcrypt.hash(randomBytes(32).toString('hex'),10);
  for(let i=1;i<=6;i++) manifest.userIds.push(await insert('sys_user',{username:`stats_test_20261027_${i}`,password_hash:hash,real_name:`统计测试学员0${i}`,role:'employee',status:1,source:'institution',category_id:manifest.categoryId}));
  const rule = {totalCents:10000,passCents:6000,durationMinutes:30,maxAttempts:3,partialCreditRatio:0.5,rules:[{type:'single',count:5,scoreCents:2000}]};
  manifest.paperId = await insert('exam_paper',{business_scope:'training',mode:'fixed',category_id:manifest.categoryId,requires_learning:0,regulation_ids:'[]',course_ids:'[]',rule_config:J(rule.rules),title,remark:'合成统计测试数据：最高分100/80/60/40，另有超时未交卷和未参考；不代表真实考试。',total_score:100,pass_score:60,duration_minutes:30,max_attempts:3,partial_credit_ratio:0.5,status:'published',created_by:actor,updated_by:actor});
  const base = new Date(Date.now()-4*3600000);
  manifest.releaseId = await insert('paper_release',{paper_id:manifest.paperId,version_no:1,business_scope:'training',mode:'fixed',category_id:manifest.categoryId,requires_learning:0,rule_snapshot:J(rule),regulation_ids:'[]',course_ids:'[]',created_by:actor,released_at:base});
  const snapshots=[];
  for(let i=1;i<=5;i++) {
    const stem=`【统计测试题${i}】数字 ${i} 加 1 的结果是多少？`;
    const options=[{key:'A',text:String(i+1)},{key:'B',text:String(i+2)},{key:'C',text:String(i+3)}];
    const content={stem:doc(stem),options:options.map(o=>({id:o.key,content:doc(o.text)})),analysis:doc('此题仅用于验证成绩与答题详情。'),answer_option_ids:['A']};
    const fields={category_id:manifest.categoryId,difficulty:'easy',type:'single',stem,options:J(options),answer:'[0]',analysis:'此题仅用于验证成绩与答题详情。',content_schema_version:2,content_json:J(content),status:'approved',source:'manual',created_by:actor};
    const qid=await insert('question',fields);
    const vid=await insert('question_version',{...fields,question_id:qid,revision:1,approved_by:actor,approved_at:base});
    manifest.questionIds.push(qid);manifest.versionIds.push(vid);
    await conn.execute('UPDATE question SET current_version_id=? WHERE id=?',[vid,qid]);
    const snapshot={questionId:qid,versionId:vid,revision:1,categoryId:manifest.categoryId,difficulty:'easy',type:'single',stem,options,answer:[0],analysis:fields.analysis,contentSchemaVersion:2,contentJson:content,scoreCents:2000,source:'manual',approvedBy:actor,approvedAt:base.toISOString()};
    snapshots.push(snapshot);
    await insert('paper_question',{paper_id:manifest.paperId,question_id:qid,question_version_id:vid,sort:i-1,score:20});
    await insert('paper_release_question',{release_id:manifest.releaseId,question_id:qid,question_version_id:vid,type:'single',difficulty:'easy',score_cents:2000,position:i-1,snapshot_json:J(snapshot)});
  }
  const grades = new GradingService();
  for(const [userIndex, correctCounts] of [[0,[5]],[1,[1,4]],[2,[3]],[3,[2]],[4,[null]]]) {
    const common={paper_id:manifest.paperId,user_id:manifest.userIds[userIndex],release_id:manifest.releaseId,source:'institution',category_id:manifest.categoryId,difficulty:'easy',rule_snapshot:J(rule),snapshot_origin:'release'};
    const aid=await insert('exam_assignment',common);manifest.assignmentIds.push(aid);
    for(let a=0;a<correctCounts.length;a++) {
      const correct=correctCounts[a], timeout=correct===null;
      const answers=new Map(snapshots.map((q,i)=>[q.questionId,[i<correct?0:1]]));
      const graded=grades.grade(answers,{partialCreditRatio:0.5},snapshots.map(q=>({questionId:q.questionId,score:20})),new Map(snapshots.map(q=>[q.questionId,q])));
      const start=new Date(base.getTime()+(userIndex*35+a*15+5)*60000), end=new Date(start.getTime()+10*60000),deadline=new Date(start.getTime()+30*60000);
      const rid=await insert('exam_record',{...common,assignment_id:aid,attempt_no:a+1,status:timeout?'timeout':graded.total>=60?'passed':'failed',score:timeout?0:graded.total,started_at:start,deadline_at:deadline,submitted_at:timeout?null:end,submission_method:timeout?'timeout':'manual',grading_state:timeout?'not_submitted':'finalized',graded_at:timeout?null:end});
      manifest.recordIds.push(rid);
      for(let i=0;i<snapshots.length;i++) {
        const q=snapshots[i];
        const item=await insert('exam_record_question',{record_id:rid,question_id:q.questionId,question_version_id:q.versionId,type:q.type,difficulty:q.difficulty,score_cents:2000,position:i,display_to_original:'[0,1,2]',snapshot_json:J(q)});
        if(!timeout) {const d=graded.details[i];await insert('exam_answer',{exam_record_id:rid,question_id:q.questionId,record_question_id:item,selected:J(d.selected),selected_option_ids:J(d.selected.map(n=>q.options[n].key)),is_correct:d.is_correct,gained_score:d.gained_score});}
      }
    }
  }
  const [[check]] = await conn.execute("SELECT COUNT(*) records, COUNT(DISTINCT user_id) participants, SUM(grading_state='finalized') graded FROM exam_record WHERE paper_id=?",[manifest.paperId]);
  assert.equal(Number(check.records),6);assert.equal(Number(check.participants),5);assert.equal(Number(check.graded),5);
  const [[inconsistent]]=await conn.execute("SELECT COUNT(*) n FROM exam_record r WHERE r.paper_id=? AND r.grading_state='finalized' AND r.score <> (SELECT SUM(a.gained_score) FROM exam_answer a WHERE a.exam_record_id=r.id)",[manifest.paperId]);
  assert.equal(Number(inconsistent.n),0);
  await conn.commit();
  await writeFile(new URL('./manifest.json',import.meta.url),J(manifest)+'\n');
  console.log(J(manifest));
} catch(error) {await conn.rollback();throw error;} finally {await conn.end();}
