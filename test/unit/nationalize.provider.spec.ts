import { NationalizeProvider } from '../../src/validations/infrastructure/nationalize.provider';

describe('NationalizeProvider', () => {
  it('añade apikey a la URL cuando está configurada', async () => {
    const urls: string[] = [];
    const provider = new NationalizeProvider({
      baseUrl: 'http://nationalize.test',
      apiKey: 'secret-key',
      timeoutMs: 100,
      fetchFn: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ count: 1, name: 'jhon', country: [] }), { status: 200 });
      },
    });
    await provider.predict('jhon');
    expect(urls).toEqual(['http://nationalize.test/?name=jhon&apikey=secret-key']);
  });
});
