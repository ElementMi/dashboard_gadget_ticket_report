import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('ping', async () => ({ ok: true, message: 'pong from Element CFG Gadget' }));

export const handler = resolver.getDefinitions();
