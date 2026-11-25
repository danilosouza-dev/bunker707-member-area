import java.lang.reflect.Constructor;
import java.nio.file.Path;

/**
 * A bancada do gravador (docs/30 A65): liga e desliga o capturador DE VERDADE do Jibri que a imagem traz
 * (FfmpegCapturer, com a configuracao dele), sem sala. Mostra se o Jibri reconhece que o ffmpeg esta gravando ("Ffmpeg
 * capturer transitioning from state ... to Running"): sem isso ele nunca confirma a gravacao ao Jicofo, que manda parar
 * em 90 s (JIBRI_PENDING_TIMEOUT; as gravacoes de 25/11/2026 com o ffmpeg 6.1). E para como na live: SIGINT.
 * Tudo por reflexao, para nao depender da assinatura exata dos construtores de cada versao.
 *   java -cp /opt/jitsi/jibri/jibri.jar:<pasta> Captura <pasta de saida> <segundos>
 */
public class Captura {
    static Object make(String name, Object... first) throws Exception {
        for (Constructor<?> c : Class.forName(name).getDeclaredConstructors()) {
            Class<?>[] t = c.getParameterTypes();
            boolean defaults = t.length > 0 && t[t.length - 1].getName().endsWith("DefaultConstructorMarker");
            int real = defaults ? t.length - 2 : t.length;
            if (real < first.length || (!defaults && real != first.length)) continue;
            boolean fits = true;
            for (int i = 0; i < first.length; i++) fits &= t[i].isInstance(first[i]);
            if (!fits) continue;
            Object[] args = new Object[t.length];
            System.arraycopy(first, 0, args, 0, first.length);
            if (defaults) args[t.length - 2] = -1 << first.length;
            c.setAccessible(true);
            return c.newInstance(args);
        }
        throw new IllegalStateException("sem construtor para " + name);
    }

    public static void main(String[] a) throws Exception {
        Object logger = make("org.jitsi.utils.logging2.LoggerImpl", "captura");
        Object sink = make("org.jitsi.jibri.sink.impl.FileSink", Path.of(a[0]), "captura");
        Object capturer = make("org.jitsi.jibri.capture.ffmpeg.FfmpegCapturer", logger);
        Class<?> k = capturer.getClass();
        long t0 = System.currentTimeMillis();
        k.getMethod("start", Class.forName("org.jitsi.jibri.sink.Sink")).invoke(capturer, sink);
        Thread.sleep(10_000);
        // Em que ponto esta cada linha de execucao do Jibri que le a saida do ffmpeg.
        Thread.getAllStackTraces().forEach((t, stack) -> {
            String where = "";
            for (StackTraceElement e : stack) if (where.length() < 700) where += " < " + e.getClassName().replaceAll(".*\\.", "") + "." + e.getMethodName() + ":" + e.getLineNumber();
            if (where.contains("Tee") || where.contains("Tail") || where.contains("JibriSubprocess") || where.contains("OutputParser")) System.err.println("PILHA " + t.getState() + where);
        });
        Thread.sleep(Long.parseLong(a[1]) * 1000 - 10_000);
        long t1 = System.currentTimeMillis();
        k.getMethod("stop").invoke(capturer);
        System.err.println("CAPTURA gravou_ms=" + (t1 - t0) + " parada_ms=" + (System.currentTimeMillis() - t1));
        System.exit(0);
    }
}
