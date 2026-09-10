/** Petite sélection de citations inspirantes pour le module Footer. */
export const QUOTES: string[] = [
  "La vie, c'est comme une bicyclette, il faut avancer pour ne pas perdre l'équilibre. — Albert Einstein",
  "Le succès, c'est se promener d'échec en échec avec enthousiasme. — Winston Churchill",
  "Il n'y a qu'une façon d'échouer, c'est d'abandonner avant d'avoir réussi. — Georges Clemenceau",
  "Ce n'est pas parce que les choses sont difficiles que nous n'osons pas, c'est parce que nous n'osons pas qu'elles sont difficiles. — Sénèque",
  "L'important n'est pas de gagner mais de participer. — Pierre de Coubertin",
  "Le doute est le commencement de la sagesse. — Aristote",
  "On ne voit bien qu'avec le cœur, l'essentiel est invisible pour les yeux. — Antoine de Saint-Exupéry",
  "Chaque jour est une nouvelle occasion de changer sa vie. — Anonyme",
  "La simplicité est la sophistication suprême. — Léonard de Vinci",
  "Le meilleur moyen de prédire l'avenir, c'est de le créer. — Peter Drucker",
  "Le plus grand risque est de ne prendre aucun risque. — Mark Zuckerberg",
  "Tout ce qui ne nous tue pas nous rend plus fort. — Friedrich Nietzsche",
  "L'échec est simplement l'occasion de recommencer avec plus d'intelligence. — Henry Ford",
  "Le bonheur n'est pas une destination, c'est une façon de voyager. — Margaret Lee Runbeck",
  "Il vaut mieux tenter sa chance que regretter de ne pas l'avoir tentée.",
  "La persévérance est la clé de la réussite.",
  "Fais de ta vie un rêve, et d'un rêve, une réalité. — Antoine de Saint-Exupéry",
  "Le savoir est la seule matière qui s'accroît quand on la partage. — Socrate",
  "Ayez le courage de suivre votre cœur et votre intuition. — Steve Jobs",
  "Rien n'est jamais perdu tant qu'il reste quelque chose à trouver. — Pierre Dac",
  "Un pessimiste voit la difficulté dans chaque opportunité ; un optimiste voit l'opportunité dans chaque difficulté. — Winston Churchill",
  "La qualité n'est jamais un accident, elle est toujours le résultat d'un effort intelligent. — John Ruskin",
  "Le voyage de mille lieues commence toujours par un premier pas. — Lao Tseu",
  "Ce que nous savons est une goutte d'eau, ce que nous ignorons est un océan. — Isaac Newton",
  "Sois le changement que tu veux voir dans le monde. — Gandhi",
];

export function randomQuote(): string {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
