# Customer Interviews — Aibenchef v1

Script para hablar con 3-10 personas que **ya pidieron precio** o que cuadran con la
persona objetivo (analistas financieros, gerencias microfinanzas, consultoras, periodistas
economicos). 25 minutos por entrevista. Objetivo: validar pricing, priorizar dashboards,
captar beta-list.

---

## Preparacion

- 1 hora antes: revisar perfil (LinkedIn, empresa).
- Grabar la llamada (con permiso). Notas paralelas.
- Si no se puede llamada: enviar las preguntas por escrito (peor pero suma).

---

## Apertura (2 min)

"Hola [nombre], gracias por el tiempo. Estoy armando una herramienta para usar la data
publica de la SBS sin tener que armar Excels a mano cada mes. Antes de construir, quiero
entender bien como trabajas hoy con esta data. Son 20-25 minutos. ¿Te parece?"

---

## Bloque 1 — Situacion actual (8 min)

1. ¿Que decisiones tomas hoy con data SBS? (analisis de competencia, monitoreo regulatorio, due diligence, reportes a directorio, otros).
2. ¿Cada cuanto bajas o trabajas con esta data? Mensual, semanal, ad-hoc.
3. Cuando necesitas un analisis nuevo, ¿como lo haces?
   - ¿Bajas .xls de la pagina SBS?
   - ¿Tienes plantillas en Excel propias? ¿Quien las arma/actualiza?
   - ¿Usas Power BI, Tableau, otra herramienta?
4. ¿Cuanto tiempo te toma armar un analisis tipico de inicio a fin? (busca numero concreto en horas).
5. ¿Que es lo que mas te frustra del proceso actual?

---

## Bloque 2 — Magic wand (5 min)

6. Si tuvieras un dashboard listo con esta data, ¿que serian las 3 cosas que querrias ver ahi primero?
7. ¿Que comparativos haces seguido? (entidad vs entidad, grupo vs grupo, evolucion temporal, ratios).
8. ¿Trabajas con un grupo especifico? (Banca Multiple / Financieras / CMAC / CRAC / EDPYME). ¿O todos?
9. ¿Necesitas exportar? PDF para directorio, Excel para seguir trabajando, API para tu propio sistema.

---

## Bloque 3 — Pricing (5 min)

10. Si esto existiera hoy y te resolviera [X horas/mes ahorradas], ¿cuanto pagarias por mes?
   - Anclar con tres rangos: "¿USD 49, 149, o 399 te suena razonable?"
   - Si dice menos: ¿por que? ¿Que esperarias por mas?
11. ¿Lo pagarias personal o tu empresa? Si empresa: ¿quien decide la compra?
12. ¿Prefieres pago mensual o anual con descuento?

---

## Bloque 4 — Cierre (3 min)

13. ¿Estarias dispuesto a probar una version beta en 6-8 semanas?
14. Si si: ¿que tendria que tener para que te suscribas?
15. ¿Conoces 1-2 personas mas que tambien lo necesiten? Pedile presentacion.

---

## Captura (despues de cada entrevista)

Llenar `docs/research/leads.csv` con:

```
fecha,nombre,empresa,rol,uso_actual,horas_mes,pain_top1,
dashboards_top3,grupos_interes,export_necesario,
willingness_to_pay_usd,decision_maker,probable_beta,referidos
```

---

## Cuando parar

- 5 entrevistas: detectas patrones claros sobre dashboards top-3 y rango de precio realista.
- 10 entrevistas: tienes muestra para hacer claims con confianza.
- Si despues de 3 nadie quiere pagar mas de USD 20/mes, parar y replantear positioning.
