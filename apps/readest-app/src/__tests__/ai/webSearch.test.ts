import { describe, it, expect, vi } from 'vitest';
import {
  filterRelevant,
  normalizeSearchQuery,
  parseBaiduHtml,
  parseBingHtml,
  parseDdgHtml,
  parseSogouHtml,
  providersFor,
  queryTokens,
  searchWebWith,
} from '@/services/ai/webSearch';

describe('parseDdgHtml', () => {
  it('extracts titles, unwrapped URLs and snippets from DDG HTML', () => {
    const html = `
      <div class="result results_links results_links_deep web-result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example <b>Title</b></a>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">A &amp; B <b>snippet</b> here</a>
      </div>`;

    expect(parseDdgHtml(html)).toEqual([
      {
        title: 'Example Title',
        url: 'https://example.com/page',
        snippet: 'A & B snippet here',
      },
    ]);
  });

  it('returns an empty list for markup without results', () => {
    expect(parseDdgHtml('<html><body>no results</body></html>')).toEqual([]);
  });

  it('caps the number of results', () => {
    const entry = (i: number) => `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F${i}">Result ${i}</a>
      <a class="result__snippet">Snippet ${i}</a>`;
    const html = Array.from({ length: 10 }, (_, i) => entry(i + 1)).join('');

    const results = parseDdgHtml(html, 3);
    expect(results).toHaveLength(3);
    expect(results[0]!.title).toBe('Result 1');
    expect(results[2]!.url).toBe('https://example.com/3');
  });
});

// u=a1 + unpadded base64("https://example.com/page")
const BING_HTML = `
  <li class="b_algo" data-id iid=SERP.1>
    <h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYWdl&amp;ntb=1" h="ID=SERP,1.2"><strong>Example</strong> Title</a></h2>
    <div class="b_caption"><p class="b_lineclamp2">A &amp; B <strong>snippet</strong> here</p></div>
  </li>
  <li class="b_algo" data-id iid=SERP.2>
    <h2><a href="https://direct.example.org/two">Second</a></h2>
    <div class="b_caption"><p>Snippet two</p></div>
  </li>`;

describe('parseBingHtml', () => {
  it('unwraps /ck/a redirect links and reads titles plus snippets', () => {
    expect(parseBingHtml(BING_HTML)).toEqual([
      {
        title: 'Example Title',
        url: 'https://example.com/page',
        snippet: 'A & B snippet here',
      },
      {
        title: 'Second',
        url: 'https://direct.example.org/two',
        snippet: 'Snippet two',
      },
    ]);
  });

  it('returns an empty list for markup without results', () => {
    expect(parseBingHtml('<html><body>no results</body></html>')).toEqual([]);
  });

  it('caps the number of results', () => {
    expect(parseBingHtml(BING_HTML, 1)).toHaveLength(1);
  });

  it('rejects the degraded SERP that pads a no-results page with filler', () => {
    const degraded = `<html>"There are no results for this question, please check your spelling"
      <ul>${BING_HTML}</ul></html>`;
    expect(parseBingHtml(degraded)).toEqual([]);
  });
});

const BAIDU_HTML = `
  <div class="result c-container xpath-log new-pmd" srcid="1599" id="2" tpl="www_index" mu="https://weather.sz.gov.cn/" data-click={"p1":2}>
    <h3 class="cosc-title t"><a class="cosc-title-a" href="http://www.baidu.com/link?url=abc">深圳市气象局</a></h3>
    <!--s-data:{"widgetData":{"temperature":29}}-->
    <div class="cosc-card-content"><span>深圳天气预警、预报与实况</span></div>
  </div>
  <div class="result-op c-container xpath-log" id="5" tpl="rel_base_realtime" mu="https://www.baidu.com/s?tn=news&amp;wd=%E6%B7%B1%E5%9C%B3">
    <h3><a href="#">相关搜索</a></h3>
  </div>
  <div class="result-op c-container" id="1" tpl="weather_forecast_new_san" mu="https://weathernew.pae.baidu.com/weathernew/pc?query=x">
    <h3 class="cosc-title"><span>生活服务</span></h3>
    <div class="cosc-card-content">短袖类 穿衣 不适宜 运动 中等 紫外线</div>
  </div>
  <div class="result c-container" id="3" tpl="feedback" mu="http://nourl.ubs.baidu.com/62631">
    <h3><a href="#">上一条搜索内容，你觉得满意吗？</a></h3>
    <div>很差 较差 一般 不错 很好</div>
  </div>
  <div class="result c-container" id="6" tpl="www_index" mu="https://baike.baidu.com/item/x">
    <div class="cosc-card-content">card without a title</div>
  </div>
  <div class="result c-container" id="7" tpl="www_index" mu="https://www.weather.com.cn/weathern/101280601.shtml">
    <h3><a href="http://www.baidu.com/link?url=def">中国天气网</a></h3>
    <p>深圳天气预报</p>
  </div>`;

describe('parseBaiduHtml', () => {
  it('reads titles, real mu links and snippets, skipping chrome cards', () => {
    expect(parseBaiduHtml(BAIDU_HTML)).toEqual([
      {
        title: '深圳市气象局',
        url: 'https://weather.sz.gov.cn/',
        snippet: '深圳天气预警、预报与实况',
      },
      {
        title: '中国天气网',
        url: 'https://www.weather.com.cn/weathern/101280601.shtml',
        snippet: '深圳天气预报',
      },
    ]);
  });

  it('returns nothing for the security interstitial', () => {
    expect(parseBaiduHtml('<html>请前往 wappass.baidu.com 完成安全验证</html>')).toEqual([]);
  });

  it('caps the number of results', () => {
    expect(parseBaiduHtml(BAIDU_HTML, 1)).toHaveLength(1);
  });
});

const SOGOU_HTML = `
  <div class="vrwrap" id="sogou_vr_0">
    <h3 class="vr-title"><a target="_blank" href="/link?url=abc" data-share="x">深圳市气象局</a></h3>
    <div class="space-txt" data-url="https://weather.sz.gov.cn/">深圳天气预警、预报与实况</div>
  </div>
  <div class="vrwrap" id="sogou_vr_1">
    <h3 class="vr-title"><a href="https://www.sogou.com/sogou?query=x">相关搜索</a></h3>
    <div data-url="https://www.sogou.com/">chrome</div>
  </div>
  <div class="vrwrap" id="sogou_vr_2">
    <h3 class="vr-title"><a href="/link?url=def">只给跳转链接的结果</a></h3>
    <div class="space-txt">没有 data-url，无法还原目的地</div>
  </div>
  <div class="vrwrap" id="sogou_vr_3">
    <h3 class="vr-title"><a href="https://www.weather.com.cn/weathern/101280601.shtml">中国天气网</a></h3>
    <div class="space-txt" data-url="https://www.weather.com.cn/weathern/101280601.shtml">深圳天气预报</div>
  </div>`;

describe('parseSogouHtml', () => {
  it('reads titles, data-url destinations and snippets, skipping chrome and redirect-only cards', () => {
    expect(parseSogouHtml(SOGOU_HTML)).toEqual([
      {
        title: '深圳市气象局',
        url: 'https://weather.sz.gov.cn/',
        snippet: '深圳天气预警、预报与实况',
      },
      {
        title: '中国天气网',
        url: 'https://www.weather.com.cn/weathern/101280601.shtml',
        snippet: '深圳天气预报',
      },
    ]);
  });

  it('returns nothing for the anti-spider interstitial', () => {
    expect(parseSogouHtml('<html>antispider: 请输入验证码</html>')).toEqual([]);
  });

  it('caps the number of results', () => {
    expect(parseSogouHtml(SOGOU_HTML, 1)).toEqual([
      {
        title: '深圳市气象局',
        url: 'https://weather.sz.gov.cn/',
        snippet: '深圳天气预警、预报与实况',
      },
    ]);
  });
});

describe('normalizeSearchQuery', () => {
  it('strips conversational wrappers around the real question', () => {
    expect(normalizeSearchQuery('查一下今天深圳的天气如何')).toBe('今天深圳的天气');
    expect(normalizeSearchQuery('请帮我搜索一下深圳天气吗')).toBe('深圳天气');
    expect(normalizeSearchQuery('今天深圳天气怎么样？')).toBe('今天深圳天气');
  });

  it('leaves plain queries untouched', () => {
    expect(normalizeSearchQuery('tauri v2 capabilities permission')).toBe(
      'tauri v2 capabilities permission',
    );
    expect(normalizeSearchQuery('深圳天气')).toBe('深圳天气');
  });

  it('falls back to the raw query when stripping would leave almost nothing', () => {
    expect(normalizeSearchQuery('如何')).toBe('如何');
    expect(normalizeSearchQuery('么')).toBe('么');
  });
});

describe('filterRelevant', () => {
  const result = (title: string, snippet = '') => ({ title, url: 'https://e.test/', snippet });

  it('tokenizes latin words and CJK bigrams', () => {
    expect(queryTokens('tauri v2 深圳天气')).toEqual(['tauri', '深圳', '圳天', '天气']);
  });

  it('drops results that share no token with the query', () => {
    expect(
      filterRelevant('深圳天气', [result('深圳天气预报'), result('Opera GX browser')]),
    ).toEqual([result('深圳天气预报')]);
  });

  it('keeps everything when the query yields no tokens', () => {
    const results = [result('Anything')];
    expect(filterRelevant('?', results)).toEqual(results);
  });
});

describe('providersFor', () => {
  it('leads with Baidu and Sogou and asks Bing for the zh market on Chinese queries', () => {
    const providers = providersFor('深圳天气');
    expect(providers.map((p) => p.name)).toEqual(['baidu', 'sogou', 'bing', 'ddg']);
    expect(providers[2]?.url('深圳天气')).toContain('mkt=zh-CN');
  });

  it('leads with Baidu and Sogou and asks Bing for the en market otherwise', () => {
    const providers = providersFor('shenzhen weather');
    expect(providers.map((p) => p.name)).toEqual(['baidu', 'sogou', 'bing', 'ddg']);
    expect(providers[2]?.url('shenzhen weather')).toContain('mkt=en-US');
  });
});

const DDG_HTML =
  '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffallback.example%2F">Fallback</a>' +
  '<a class="result__snippet">From DDG</a>';

function htmlResponse(html: string): Response {
  return { ok: true, status: 200, text: async () => html } as unknown as Response;
}

const BING_ZH_HTML = `
  <li class="b_algo">
    <h2><a href="https://www.weather.com.cn/weathern/101280601.shtml">深圳天气预报</a></h2>
    <div class="b_caption"><p>中国天气网深圳实况</p></div>
  </li>`;

describe('searchWebWith', () => {
  it('returns Baidu results without consulting the fallbacks', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      htmlResponse(url.includes('baidu.com') ? BAIDU_HTML : ''),
    );

    const results = await searchWebWith(fetchImpl as unknown as typeof fetch, '深圳天气');

    expect(results[0]?.url).toBe('https://weather.sz.gov.cn/');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to Sogou while Baidu is in its captcha cooldown', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      htmlResponse(url.includes('sogou.com') ? SOGOU_HTML : ''),
    );

    const results = await searchWebWith(fetchImpl as unknown as typeof fetch, '深圳天气');

    expect(results[0]?.url).toBe('https://weather.sz.gov.cn/');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to Bing when Baidu and Sogou parse nothing', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      htmlResponse(url.includes('bing.com') ? BING_HTML : ''),
    );

    const results = await searchWebWith(fetchImpl as unknown as typeof fetch, 'example');

    expect(results[0]?.url).toBe('https://example.com/page');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('falls back to DuckDuckGo when Bing is unreachable', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('bing.com')) throw new Error('connection timed out');
      return htmlResponse(url.includes('duckduckgo.com') ? DDG_HTML : '');
    });

    const results = await searchWebWith(fetchImpl as unknown as typeof fetch, 'fallback');

    expect(results).toEqual([
      { title: 'Fallback', url: 'https://fallback.example/', snippet: 'From DDG' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('falls back when Bing answers with a degraded page', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      htmlResponse(
        url.includes('bing.com')
          ? '<html>There are no results for this question</html>'
          : url.includes('duckduckgo.com')
            ? DDG_HTML
            : '',
      ),
    );

    const results = await searchWebWith(fetchImpl as unknown as typeof fetch, 'fallback');

    expect(results[0]?.title).toBe('Fallback');
  });

  it('throws when every provider fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('all down');
    });

    await expect(searchWebWith(fetchImpl as unknown as typeof fetch, 'query')).rejects.toThrow(
      'all down',
    );
  });

  it('asks Bing for the zh market when a Chinese query gets past Baidu and Sogou', async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requested.push(url);
      if (url.includes('baidu.com')) throw new Error('blocked');
      return htmlResponse(url.includes('bing.com') ? BING_ZH_HTML : '');
    });

    const results = await searchWebWith(fetchImpl as unknown as typeof fetch, '深圳天气');

    expect(results[0]?.title).toBe('深圳天气预报');
    expect(requested[0]).toContain('baidu.com/s?wd=');
    expect(requested[1]).toContain('sogou.com/web?query=');
    expect(requested[2]).toContain('mkt=zh-CN');
  });

  it('injects nothing when every result is unrelated filler', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      htmlResponse(url.includes('bing.com') ? BING_HTML : ''),
    );

    await expect(searchWebWith(fetchImpl as unknown as typeof fetch, '深圳天气')).resolves.toEqual(
      [],
    );
  });
});
