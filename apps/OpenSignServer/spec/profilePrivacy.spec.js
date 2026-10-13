import Parse from 'parse/node';
import {guardExtUserAuthority, rejectSelfSignup} from '../cloud/parsefunction/accessGuards.js';

describe('private linked-user profiles', () => {
  let saved;
  beforeAll(() => {saved=globalThis.Parse;globalThis.Parse=Parse;});
  afterAll(() => {globalThis.Parse=saved;});
  beforeEach(() => { spyOn(Parse.Query.prototype, 'get').and.resolveTo({ id: 'owner' }); });
  const profile = (owner='owner', fields={}, acl=null) => {
    const data={UserId:owner ? {className:'_User',id:owner} : null,...fields};
    return {get:key=>data[key],getACL:()=>acl ? new Parse.ACL(acl) : null,setACL:value=>{acl=value.toJSON();},isNew:()=>false};
  };
  const req=(original, object, caller='owner')=>({master:false,original,object,user:{id:caller}});
  it('denies a stranger editing a legacy profile with no ACL', () => {
    expect(()=>guardExtUserAuthority(req(profile(),profile('owner',{Name:'Changed'}),'stranger'))).toThrow(jasmine.objectContaining({code:119}));
  });
  it('denies editing an orphan profile even if the caller is signed in', () => {
    expect(()=>guardExtUserAuthority(req(profile(null),profile(null,{Name:'Changed'})))).toThrow(jasmine.objectContaining({code:119}));
  });
  it('lets the linked owner update non-authority fields', () => {
    expect(()=>guardExtUserAuthority(req(profile(),profile('owner',{Name:'Changed',TourStatus:[]})))).not.toThrow();
  });
  it('denies the linked owner widening its ACL', () => {
    expect(()=>guardExtUserAuthority(req(profile(),profile('owner',{}, {'*':{read:true,write:true}})))).toThrow(jasmine.objectContaining({code:119}));
  });
  it('denies the linked owner changing the legacy signing-user pointer', () => {
    expect(() => guardExtUserAuthority(req(profile('owner', {UserPtr:{className:'_User',id:'owner'}}), profile('owner', {UserPtr:{className:'_User',id:'other'}})))).toThrow(jasmine.objectContaining({code:119}));
  });
  it('defaults every master-created linked profile to owner-only access', async () => {
    const object=profile('owner',{}, {'*':{read:true,write:true}});
    await guardExtUserAuthority({master:true,object});
    expect(object.getACL().toJSON()).toEqual({owner:{read:true,write:true}});
  });
  it('leaves an orphan master-only without inventing an owner', async () => {
    const object=profile(null,{}, {'*':{read:true,write:true}});
    await guardExtUserAuthority({master:true,object});
    expect(object.getACL().toJSON()).toEqual({});
  });
  it('keeps a dangling user pointer master-only', async () => {
    Parse.Query.prototype.get.and.rejectWith(new Parse.Error(101, 'missing'));
    const object = profile('deleted-owner', {}, {'*':{read:true,write:true}});
    await guardExtUserAuthority({master:true,object});
    expect(object.getACL().toJSON()).toEqual({});
  });
  it('fails closed when user existence cannot be checked', async () => {
    Parse.Query.prototype.get.and.rejectWith(new Error('database unavailable'));
    await expectAsync(guardExtUserAuthority({master:true,object:profile()})).toBeRejected();
  });
  for(const field of ['email','username']) {
    it(`rejects a non-master changing signing identity ${field}`, () => {
      const original=profile(null,{email:'own@example.test',username:'own@example.test'});
      const object=profile(null,{email:'own@example.test',username:'own@example.test',[field]:'other@example.test'});
      expect(()=>rejectSelfSignup({master:false,original,object})).toThrow(jasmine.objectContaining({code:119}));
    });
  }
});
