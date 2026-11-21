const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadTypeScript}=require('./loadTypeScript.cjs');
const {sourceTextLines,sourceLineAt,sourceLineForWord}=loadTypeScript(require('node:path').resolve(__dirname,'../src/lib/textLines.ts'));
test('native lines retain exact source word ordinals through wrapping and repeated words',()=>{
 const lines=sourceTextLines('One extraordinary word. One repeated word.',[
  {text:'One extra',y:0,height:20},{text:'ordinary word.',y:20,height:20},{text:'One repeated',y:40,height:20},{text:'word.',y:60,height:20}
 ],7);
 assert.deepEqual(lines.map(l=>l.word),[7,8,10,12]);
 assert.equal(sourceLineAt(lines,23).word,8);
 assert.equal(sourceLineForWord(lines,11).y,40);
});
test('unmatched or invalid native measurements are ignored rather than guessing a location',()=>{
 assert.deepEqual(sourceTextLines('Actual text.',[{text:'different',y:0,height:10},{text:'Actual',y:NaN,height:10}]),[]);
});
