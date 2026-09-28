import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidates } from '../web/candidate-review.mjs';
test('candidate filters separate review status from resolution and never mutate inputs', () => {
  const rows = [
    {name:'client',source:'portal',key:'orders.url',eligibility:'unknown',targetResolution:'unique',extraction:{status:'unreviewed'}},
    {name:'other',source:'worker',eligibility:'unknown',targetResolution:'unresolved',extraction:{status:'accepted',reviewer:'Ping'}},
    {name:'legacy',source:'worker',eligibility:'disabled',targetResolution:'unique'},
  ];
  const before=JSON.stringify(rows);
  assert.deepEqual(filterCandidates(rows,'','unreviewed'),[rows[0]]);
  assert.deepEqual(filterCandidates(rows,' PING ','accepted'),[rows[1]]);
  assert.deepEqual(filterCandidates(rows,'orders.url','ai'),[rows[0]]);
  assert.equal(filterCandidates(rows,'','investigate').length,2);
  assert.equal(filterCandidates(rows,'','rejected').length,0);
  assert.equal(filterCandidates(rows,'').length,3);
  assert.equal(JSON.stringify(rows),before);
});
