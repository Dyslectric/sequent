/**
 * Curated proof demonstrations.
 *
 * Each demo is a complete, independent sheet. Keep the steps small enough that
 * a reader can see which obligation each verdict belongs to; test/demos.test.mjs
 * verifies that every claimed step remains exact.
 */

export const DEMOS = [
  {
    id: 'polynomial-identity',
    topic: 'Algebra',
    title: 'A polynomial identity',
    description: 'Name two elementary rewrites, prove each one, then verify the complete equality chain.',
    lines: [
      '\\text{squareExpansion}(x):=(x+1)^2=x^2+2x+1',
      '\\forall x\\in\\mathbb{R},\\text{squareExpansion}(x)',
      '\\text{termReordering}(x):=x^2+2x+1=x^2+1+2x',
      '\\forall x\\in\\mathbb{R},\\text{termReordering}(x)',
      '\\forall x\\in\\mathbb{R},(x+1)^2=x^2+2x+1=x^2+1+2x',
      '',
    ],
  },
  {
    id: 'quadratic-inequality',
    topic: 'Inequalities',
    title: 'A quadratic inequality',
    description: 'Rewrite the gap as a square, establish non-negativity, and conclude a² + b² ≥ 2ab.',
    lines: [
      '\\text{gapIdentity}(a,b):=a^2+b^2-2ab=(a-b)^2',
      '\\forall a\\in\\mathbb{R},\\forall b\\in\\mathbb{R},\\text{gapIdentity}(a,b)',
      '\\text{squareNonnegative}(x):=x^2\\ge0',
      '\\forall x\\in\\mathbb{R},\\text{squareNonnegative}(x)',
      '\\forall a\\in\\mathbb{R},\\forall b\\in\\mathbb{R},'
        + 'a^2+b^2-2ab=(a-b)^2\\ge0',
      '\\forall a\\in\\mathbb{R},\\forall b\\in\\mathbb{R},a^2+b^2\\ge2ab',
      '',
    ],
  },
  {
    id: 'logical-equivalence',
    topic: 'Logic',
    title: 'Negating a disjunction',
    description: 'Name the outside and inside regions, then verify their De Morgan equivalence exactly.',
    lines: [
      '\\text{outside}(x):=x>0\\lor x<-1',
      '\\text{inside}(x):=x\\le0\\land x\\ge-1',
      '\\forall x\\in\\mathbb{R},\\neg\\text{outside}(x)\\iff\\text{inside}(x)',
      '\\text{positive}(x):=x>0',
      '\\forall x\\in\\mathbb{R},\\text{positive}(x)'
        + '\\implies x\\ne0\\land x^2>0',
      '\\forall x\\in\\mathbb{R},\\neg(x=0)\\iff x\\ne0',
      '',
    ],
  },
  {
    id: 'implication-rules',
    topic: 'Logic',
    title: 'Rules for implications',
    description: 'Weaken a conjunction, shift and scale an inequality, and build an equivalence from both directions.',
    lines: [
      'x>y\\land u>v\\vdash x>y',
      'x>y\\vdash x+1>y',
      'a>b\\vdash a/2>b/2',
      'x>y\\iff x+1>y+1',
      'x^2\\ge 0\\land y^2\\ge 0',
      '',
    ],
  },
  {
    id: 'set-lemmas',
    topic: 'Set theory',
    title: 'Power sets and inclusion',
    description: 'Prove reusable extensional lemmas, then use them in a local sequent.',
    lines: [
      '\\text{powerMember}(X,A):=X\\in\\mathcal{P}(A)\\iff X\\subseteq A',
      '\\text{powerMember}(X,A)',
      '\\text{subsetTransitive}(A,B,C):='
        + 'A\\subseteq B\\land B\\subseteq C\\implies A\\subseteq C',
      '\\text{subsetTransitive}(A,B,C)',
      'X\\in\\mathcal{P}(A)\\land A\\subseteq B\\vdash X\\in\\mathcal{P}(B)',
      'A\\subseteq B\\vdash A\\times C\\subseteq B\\times C',
      '',
    ],
  },
  {
    id: 'induction',
    topic: 'Induction',
    title: 'n² is at least n',
    description: 'Define the predicate, inspect the base and step obligations separately, then close induction.',
    lines: [
      'P(n):=n^2\\ge n',
      '\\mathsf{Base}(P,0)',
      '\\mathsf{Step}(P,0)',
      '\\mathsf{Base}(P,0)\\land\\mathsf{Step}(P,0)',
      '\\mathsf{Induct}(P,0)',
      '',
    ],
  },
  {
    id: 'finite-group',
    topic: 'Group theory',
    title: 'Certifying ℤ/4ℤ',
    description: 'Build addition modulo four and check closure, associativity, identity, inverses, and commutativity.',
    lines: [
      'G:=\\{0,1,2,3\\}',
      'm(a,b):=\\operatorname{mod}(a+b,4)',
      '\\mathsf{Clo}(G,m)',
      '\\mathsf{Asc}(G,m)',
      '\\mathsf{Idn}(G,m,0)',
      '\\mathsf{Inv}(G,m,0)',
      '\\mathsf{Grp}(G,m,0)',
      '\\mathsf{Abl}(G,m)',
      '',
    ],
  },
  {
    id: 'vector-space',
    topic: 'Linear algebra',
    title: 'F₃ as a vector space',
    description: 'Check the vectors are an abelian group and the scalars are a field, then certify the space itself.',
    lines: [
      'V:=\\{0,1,2\\}',
      'p(x,y):=\\operatorname{mod}(x+y,3)',
      'F:=\\{0,1,2\\}',
      'q(a,b):=\\operatorname{mod}(a+b,3)',
      't(a,b):=\\operatorname{mod}(ab,3)',
      's(a,x):=\\operatorname{mod}(ax,3)',
      '\\mathsf{Abl}(V,p)',
      '\\mathsf{Fld}(F,q,t,0,1)',
      '\\mathsf{Vec}(V,p,0,F,q,t,0,1,s)',
      '',
    ],
  },
  {
    id: 'epsilon-delta',
    topic: 'Analysis',
    title: 'An ε–δ continuity witness',
    description: 'Choose δ = ε/2 for g(x) = 2x + 1, prove its positivity, and check continuity and the limit.',
    lines: [
      'g(x):=2x+1',
      'd(\\epsilon):=\\epsilon/2',
      '\\epsilon>0\\vdash d(\\epsilon)>0',
      '\\operatorname{cont}(g,a,\\epsilon,d(\\epsilon))',
      '\\operatorname{limitw}(g,a,2a+1,\\epsilon,d(\\epsilon))',
      '',
    ],
  },
  {
    id: 'topology-axioms',
    topic: 'Topology',
    title: 'The discrete topology',
    description: 'Walk through the four topology obligations, assemble the certificate, and derive finite intersections.',
    lines: [
      '\\tau:=\\mathsf{Disc}(\\mathbb{R})',
      '\\mathsf{Ax}_{\\varnothing}(\\tau,\\mathbb{R})',
      '\\mathsf{Ax}_{X}(\\tau,\\mathbb{R})',
      '\\mathsf{Ax}_{\\bigcup}(\\tau,\\mathbb{R})',
      '\\mathsf{Ax}_{\\cap}(\\tau,\\mathbb{R})',
      '\\mathsf{Top}(\\tau,\\mathbb{R})',
      '\\mathcal{O}(U,\\tau)\\land\\mathcal{O}(V,\\tau)'
        + '\\vdash\\mathcal{O}(U\\cap V,\\tau)',
      '',
    ],
  },
  {
    id: 'euler-real-part',
    topic: 'Complex numbers',
    title: 'The real part of eⁱᵗ',
    description: 'Verify each conjugation and exponential rewrite before checking the cumulative Euler chain.',
    lines: [
      '\\forall t\\in\\mathbb{R},\\operatorname{Re}(e^{it})='
        + '\\frac{e^{it}+\\overline{e^{it}}}{2}',
      '\\forall t\\in\\mathbb{R},\\frac{e^{it}+\\overline{e^{it}}}{2}='
        + '\\frac{e^{it}+e^{\\overline{it}}}{2}',
      '\\forall t\\in\\mathbb{R},\\frac{e^{it}+e^{\\overline{it}}}{2}='
        + '\\frac{e^{it}+e^{-it}}{2}',
      '\\forall t\\in\\mathbb{R},\\frac{e^{it}+e^{-it}}{2}=\\cos(t)',
      '\\forall t\\in\\mathbb{R},\\operatorname{Re}(e^{it})='
        + '\\frac{e^{it}+\\overline{e^{it}}}{2}='
        + '\\frac{e^{it}+e^{\\overline{it}}}{2}='
        + '\\frac{e^{it}+e^{-it}}{2}=\\cos(t)',
      '',
    ],
  },
];

export const DEFAULT_DEMO_ID = DEMOS[0].id;

export function demoById(id) {
  return DEMOS.find((demo) => demo.id === id) ?? DEMOS[0];
}
