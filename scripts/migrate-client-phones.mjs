import mongoose from "mongoose";

/**
 * Pasa los clientes viejos al esquema nuevo: `phone` y `whatsapp` se juntan en
 * `phones`, sin duplicados. El CUIT no se puede inventar: queda vacío y lo
 * completa alguien la primera vez que edite el cliente.
 *
 * Se puede correr las veces que haga falta: sólo toca los que todavía no migraron.
 */
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("Falta MONGODB_URI");

await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
const clients = mongoose.connection.collection("clients");

const pending = await clients.find({ phones: { $exists: false } }).toArray();
let migrated = 0;

for (const client of pending) {
  const phones = [...new Set([client.phone, client.whatsapp].map(value => String(value || "").trim()).filter(Boolean))];
  await clients.updateOne({ _id: client._id }, { $set: { phones }, $unset: { phone: "", whatsapp: "" } });
  migrated += 1;
}

const withoutCuit = await clients.countDocuments({ $or: [{ cuit: { $exists: false } }, { cuit: "" }] });
console.log(`[migracion] ${migrated} de ${pending.length} clientes pasados a la lista de telefonos`);
console.log(`[migracion] ${withoutCuit} clientes todavia sin CUIT: hay que cargarlo al editarlos`);

await mongoose.disconnect();
