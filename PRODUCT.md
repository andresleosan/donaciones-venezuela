# PRODUCT.md — Respuesta Humanitaria Venezuela

## Register
product — UI de aplicación: la interfaz sirve a tareas urgentes (pedir ayuda, donar, coordinar logística). El diseño desaparece detrás de la tarea.

## Users & Purpose
- **Afectados** por el terremoto: encontrar centros cerca, buscar familiares. Contexto: móvil, datos limitados, estrés alto.
- **Donantes**: donar dinero a una necesidad concreta o un insumo que ya tienen, y seguir su donación por token.
- **Voluntarios**: ver dónde se les necesita (centro/hospital/refugio/zona de derrumbe) y de qué tipo, y registrarse.
- **Transportistas**: mover insumos (comprados u ofrecidos) entre puntos, con evidencia fotográfica.
- **Centros** (token+PIN) y **administradores** (clave): publicar necesidades, presupuestos y vacantes; confirmar recepciones.

## Brand personality
Confiable, calmada, directa. Referencia visual: Stripe (índigo #635BFF, tinta #0A2540, Inter). En una emergencia la calma y la claridad son la marca.

## Anti-references
- Estética de "sitio de caridad" con fotos lacrimógenas y rojos de alarma por todas partes.
- Dashboards SaaS genéricos con métricas-héroe decorativas.
- Cualquier fricción de registro innecesaria: cada pantalla responde "¿qué hago aquí?" en un segundo.

## Strategic design principles
1. Una pregunta por pantalla; puertas, no menús.
2. Datos vivos de Supabase o estado de error honesto — nunca datos falsos.
3. La urgencia se codifica con color semántico (--critical/--warning), no con gritos tipográficos.
4. Todo flujo termina en algo accionable: un token, un WhatsApp, una dirección.
5. Accesibilidad: aria-pressed en segmentados, aria-live en grillas, foco gestionado al cambiar de vista.
