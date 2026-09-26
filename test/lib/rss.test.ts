import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchRssItems } from "../../src/lib/rss";

function fakeXmlResponse(xml: string, status = 200): Response {
  return new Response(xml, { status });
}

const RSS2_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Le Monde</title>
    <item>
      <title>Titre article 1</title>
      <link>https://example.com/article1</link>
      <description>Description simple de l'article 1</description>
      <pubDate>Wed, 17 Sep 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Titre article 2</title>
      <link>https://example.com/article2</link>
      <description>&lt;p&gt;Description avec du &lt;b&gt;HTML&lt;/b&gt; &amp; des accents éà&lt;/p&gt;</description>
      <pubDate>Wed, 17 Sep 2026 07:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Titre article 3</title>
      <link>https://example.com/article3</link>
      <description>Description article 3</description>
      <pubDate>Wed, 17 Sep 2026 06:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>GitHub Releases</title>
  <entry>
    <title>v1.2.3</title>
    <link href="https://github.com/example/repo/releases/tag/v1.2.3" rel="alternate"/>
    <summary>Notes de version pour la 1.2.3</summary>
    <updated>2026-09-17T08:00:00Z</updated>
  </entry>
</feed>`;

const RSS2_SINGLE_ITEM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Seul article</title>
      <link>https://example.com/only</link>
      <description>Unique</description>
    </item>
  </channel>
</rss>`;

const WORDPRESS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item>
      <title>Article de blog</title>
      <link>https://example.com/blog/article</link>
      <description><![CDATA[Extrait court.]]></description>
      <content:encoded><![CDATA[<p>Corps complet de l'article, bien plus détaillé que l'extrait.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

describe("fetchRssItems", () => {
  test("parse un flux RSS 2.0 (link en texte, description avec entités HTML nettoyées)", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(RSS2_FIXTURE));
    const items = await fetchRssItems("https://example.com/rss.xml", 10);

    assert.equal(items.length, 3);
    assert.deepEqual(items[0], {
      source: "example.com",
      title: "Titre article 1",
      link: "https://example.com/article1",
      description: "Description simple de l'article 1",
      pubDate: "Wed, 17 Sep 2026 08:00:00 GMT",
    });
    assert.equal(items[1].description, "Description avec du HTML & des accents éà");
  });

  test("parse un flux Atom (link en attribut href, summary comme description, updated comme date)", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(ATOM_FIXTURE));
    const [item] = await fetchRssItems("https://example.com/releases.atom", 10);

    assert.equal(item.title, "v1.2.3");
    assert.equal(item.link, "https://github.com/example/repo/releases/tag/v1.2.3");
    assert.equal(item.description, "Notes de version pour la 1.2.3");
    assert.equal(item.pubDate, "2026-09-17T08:00:00Z");
  });

  test("respecte la limite maxItems même si le flux contient plus d'articles", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(RSS2_FIXTURE));
    const items = await fetchRssItems("https://example.com/rss.xml", 2);
    assert.equal(items.length, 2);
  });

  test("la source est le nom de domaine du flux, sans le préfixe www.", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(RSS2_SINGLE_ITEM_FIXTURE));
    const [item] = await fetchRssItems("https://www.lemonde.fr/pixels/rss_full.xml", 10);
    assert.equal(item.source, "lemonde.fr");
  });

  test("un flux avec un seul <item> (objet, pas tableau) est géré comme les autres", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(RSS2_SINGLE_ITEM_FIXTURE));
    const items = await fetchRssItems("https://example.com/rss.xml", 10);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Seul article");
  });

  test("lève une erreur explicite en cas d'échec HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse("", 404));
    await assert.rejects(() => fetchRssItems("https://example.com/rss.xml", 10), /flux RSS a répondu 404/);
  });

  test("un flux sans <item> ni <entry> reconnu renvoie une liste vide plutôt que de jeter", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse("<rss><channel><title>Vide</title></channel></rss>"));
    const items = await fetchRssItems("https://example.com/rss.xml", 10);
    assert.deepEqual(items, []);
  });

  test("préfère content:encoded (corps complet, courant sur WordPress) à description quand présent", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(WORDPRESS_FIXTURE));
    const [item] = await fetchRssItems("https://example.com/blog/feed", 10);
    assert.equal(item.description, "Corps complet de l'article, bien plus détaillé que l'extrait.");
  });

  test("tronque une description trop longue (ex: article entier via content:encoded) plutôt que de tout envoyer à l'IA", async (t) => {
    const longBody = "a".repeat(2000);
    const xml = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>T</title><link>https://example.com</link><content:encoded><![CDATA[${longBody}]]></content:encoded></item></channel></rss>`;
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(xml));
    const [item] = await fetchRssItems("https://example.com/rss.xml", 10);
    assert.equal(item.description.length, 1501);
    assert.ok(item.description.endsWith("…"));
  });

  test("décode aussi les entités du titre, pas seulement de la description (courant sur les flux WordPress, ex: &#8217; pour l'apostrophe)", async (t) => {
    const xml = `<rss><channel><item><title>Meta ajoute de l&#8217;IA dans ses abonnements</title><link>https://example.com</link><description>D</description></item></channel></rss>`;
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(xml));
    const [item] = await fetchRssItems("https://example.com/rss.xml", 10);
    assert.equal(item.title, "Meta ajoute de l’IA dans ses abonnements");
  });

  test("décode les entités numériques décimales/hexadécimales et les entités nommées typographiques", async (t) => {
    const xml = `<rss><channel><item><title>T</title><link>https://example.com</link><description>&#160;espace insécable, guillemet &#x00AB;ici&#x00BB;, apostrophe &rsquo;typographique&rsquo;</description></item></channel></rss>`;
    t.mock.method(globalThis, "fetch", async () => fakeXmlResponse(xml));
    const [item] = await fetchRssItems("https://example.com/rss.xml", 10);
    assert.equal(item.description, "espace insécable, guillemet «ici», apostrophe ’typographique’");
  });
});
