import net from "node:net";

export interface NetworkPrinterTarget {
  host: string;
  port: number;
}

/**
 * Envoie un buffer de commandes ESC/POS brutes à une imprimante réseau via
 * une simple socket TCP (port 9100 = "raw/JetDirect", standard sur la quasi
 * totalité des imprimantes thermiques ESC/POS).
 */
export function sendToPrinter(buffer: Buffer, target: NetworkPrinterTarget, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error(`Délai dépassé en contactant l'imprimante ${target.host}:${target.port}`));
    }, timeoutMs);

    socket.on("error", (err) => {
      finish(new Error(`Impossible de contacter l'imprimante ${target.host}:${target.port} (${err.message})`));
    });

    socket.connect(target.port, target.host, () => {
      socket.write(buffer, (err) => {
        if (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        socket.end();
      });
    });

    socket.on("close", () => finish());
  });
}
