import {describe,it,expect} from 'vitest';
import {classifyFilePreviewError} from './filePreviewErrorUtils';
describe('typed file failure classification',()=>{
 it.each([
  [{code:403,message:'File not found'},'permission_denied'],
  [{code:'EACCES',message:'gone'},'permission_denied'],
  [{code:404,message:'Access denied'},'not_found'],
  [{code:'EISDIR'},'type_changed'],
  [{code:400,message:'path is not a directory'},'type_changed'],
  [new TypeError('Failed to fetch'),'connection_error'],
  [new Error('Failed to render media preview'),'render_error'],
 ])('retains authoritative error classification for %j',(error,kind)=>expect(classifyFilePreviewError(error)).toBe(kind));
});
