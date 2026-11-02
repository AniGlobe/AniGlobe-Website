export const site = {
  name: "AniCard",
  mark: "A",
  tagline: "Your taste, as a card. And one anime a day.",
  url: "",
  support: "",
  year: new Date().getFullYear(),
};

var C = String.fromCharCode;
var D = C(46);
var S = C(47);
var CO = C(58);
var PROTO = "https" + CO + S + S;

function host(parts) { return PROTO + parts.join(D); }

export const runtime = {
  anilistEndpoint: host(["graphql", "anilist", "co"]),
  jikanEndpoint: host(["api", "jikan", "moe"]) + S + "v4",
  storagePrefix: "anicard:v1:",
  dataBase: "../data/",
  htmlToImageUrl: host(["cdn", "jsdelivr", "net"]) + S + "npm" + S + "html-to-image" + C(64) + "1.11.11" + S + "dist" + S + "html-to-image.js",
  htmlToImageGlobal: "htmlToImage",
};

export const tools = [
  { id: "card", label: "Taste card", load: () => import("./tools/card.js") },
  { id: "daily", label: "Daily guess", load: () => import("./tools/daily.js") },
];

export const defaultToolId = tools