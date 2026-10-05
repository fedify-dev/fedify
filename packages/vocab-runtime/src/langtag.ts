/**
 * Extended language subtags (extlangs) registered in the IANA Language Subtag
 * Registry, grouped by their prefixes.  Every extlang record has exactly one
 * prefix and a `Preferred-Value` equal to the extlang subtag itself, so
 * replacing the prefix and the extlang with the extlang alone yields
 * the canonical form.
 *
 * Generated from the registry with File-Date: 2026-09-17.
 */
const EXTLANGS: Record<string, string> = {
  ar: "aao abh abv acm acq acw acx acy adf aeb aec afb ajp apc apd arb arq " +
    "ars ary arz auz avl ayh ayl ayn ayp bbz pga shu ssh",
  kok: "gom knn",
  lv: "ltg lvs",
  ms: "bjn btj bve bvu coa dup hji jak jax kvb kvr kxd lce lcf liw max meo " +
    "mfa mfb min mqg msi mui orn ors pel pse tmw urk vkk vkt xmm zlm zmi " +
    "zsm",
  sgn: "ads aed aen afg ajs ase asf asp asq asw bfi bfk bog bqn bqy bvl bzs " +
    "cds csc csd cse csf csg csl csn csq csr csx doq dse dsl dsz dyl ecs " +
    "ehs esl esn eso eth fcs fse fsl fss gds gse gsg gsm gss gus hab haf " +
    "hds hks hos hps hsh hsl icl iks ils inl ins ise isg isr jcs jhs jks " +
    "jls jos jsl jus kgi kvk lbs lgs lls lsb lsc lsg lsl lsn lso lsp lst " +
    "lsv lsw lsy lws mdl mfs mre msd msr mzc mzg mzy nbs ncs nsi nsl nsp " +
    "nsr nzs okl pgz pks prl prz psc psd psg psl pso psp psr pys rib rms " +
    "rnb rsi rsl rsm rsn sdl sfb sfs sgg sgx slf sls sqk sqs sqx ssp ssr " +
    "svk swl syy szs tse tsm tsq tss tsy tza ugn ugy ukl uks vgt vsi vsl " +
    "vsv wbs xki xml xms yds ygs yhs ysl ysm zhk zib zsl",
  sw: "swc swh",
  uz: "uzn uzs",
  zh: "cdo cjy cmn cnp cpx csp czh czo gan hak hnm hsn luh lzh mnp nan sjc " +
    "wuu yue",
};

const EXTLANG_PAIRS: ReadonlySet<string> = new Set(
  Object.entries(EXTLANGS).flatMap(([prefix, extlangs]) =>
    extlangs.split(" ").map((extlang) => `${prefix}-${extlang}`)
  ),
);

const PREFIX_PATTERN = /^[A-Za-z]{2,3}$/;
const EXTLANG_PATTERN = /^[A-Za-z]{3}$/;

/**
 * Normalizes a BCP 47 language tag that has an extended language subtag
 * (extlang), such as `zh-yue`, into its canonical form, such as `yue`, as
 * described in [RFC 5646, Section 4.5][1].  `Intl.Locale` rejects extlang
 * tags, so tags should be normalized before being passed to it.
 *
 * Only registered extlangs that follow their registered prefix are removed;
 * any other tag is returned unchanged, so the result still needs to be
 * validated, e.g., by `Intl.Locale`.
 *
 * NOTE: This function is marked as internal in the 2.0.x–2.4.x patch
 * releases.  When merging it into the *main* branch, remove the `@internal`
 * tag, formalize it as a public API (`@since 2.5.0`), and add it to
 * the changelog fragment.
 *
 * [1]: https://www.rfc-editor.org/rfc/rfc5646.html#section-4.5
 *
 * @param tag The BCP 47 language tag to normalize.
 * @returns The normalized language tag.
 * @internal
 */
export function normalizeLanguageTag(tag: string): string {
  const subtags = tag.split("-");
  if (subtags.length < 2) return tag;
  const [prefix, extlang, ...rest] = subtags;
  // Checked before case folding, since `toLowerCase()` maps some non-ASCII
  // characters (e.g., U+212A KELVIN SIGN) to ASCII letters:
  if (!PREFIX_PATTERN.test(prefix) || !EXTLANG_PATTERN.test(extlang)) {
    return tag;
  }
  const language = extlang.toLowerCase();
  if (!EXTLANG_PAIRS.has(`${prefix.toLowerCase()}-${language}`)) return tag;
  return [language, ...rest].join("-");
}
