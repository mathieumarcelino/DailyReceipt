import type { ReceiptModule } from "./types";
import headerModule from "./header.module";
import weatherModule from "./weather.module";
import birthdaysModule from "./birthdays.module";
import marketsModule from "./markets.module";
import footerModule from "./footer.module";

/**
 * Registre central des modules disponibles. Pour ajouter un nouveau module :
 * créer un fichier `mon-module.module.ts` implémentant `ReceiptModule`, puis
 * l'importer et l'ajouter à ce tableau. C'est le seul endroit à modifier.
 */
export const MODULE_REGISTRY: ReceiptModule<any, any>[] = [headerModule, weatherModule, birthdaysModule, marketsModule, footerModule];

export function getModule(id: string): ReceiptModule<any, any> | undefined {
  return MODULE_REGISTRY.find((m) => m.id === id);
}
