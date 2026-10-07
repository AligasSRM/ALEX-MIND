import javax.swing.*;
import java.awt.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.concurrent.Executors;

public class AlexMindDesktop {
  static final String API="https://alex-mind.srourr-ali73.workers.dev";
  static JLabel status=new JLabel("● CHECKING");
  static JLabel detail=new JLabel("Connecting to ALEX-MIND backend…");

  static void check() {
    status.setText("● CHECKING"); status.setForeground(new Color(255,193,7));
    detail.setText("Connecting to ALEX-MIND backend…");
    Executors.newSingleThreadExecutor().execute(() -> {
      try {
        HttpURLConnection c=(HttpURLConnection)URI.create(API+"/health").toURL().openConnection();
        c.setRequestMethod("GET"); c.setConnectTimeout(8000); c.setReadTimeout(8000);
        int code=c.getResponseCode();
        SwingUtilities.invokeLater(() -> {
          if(code==200){status.setText("● ONLINE");status.setForeground(new Color(60,220,120));detail.setText("HTTPS /health returned 200 OK");}
          else {status.setText("● OFFLINE");status.setForeground(new Color(255,80,80));detail.setText("Backend returned HTTP "+code);}
        });
        c.disconnect();
      } catch(Exception e) {
        SwingUtilities.invokeLater(() -> {status.setText("● OFFLINE");status.setForeground(new Color(255,80,80));detail.setText("Connection failed: "+e.getClass().getSimpleName());});
      }
    });
  }

  public static void main(String[] args){
    SwingUtilities.invokeLater(() -> {
      JFrame f=new JFrame("ALEX-MIND");
      f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE); f.setSize(520,420); f.setLocationRelativeTo(null);
      JPanel p=new JPanel(); p.setBorder(BorderFactory.createEmptyBorder(32,36,32,36)); p.setLayout(new BoxLayout(p,BoxLayout.Y_AXIS)); p.setBackground(new Color(11,13,16));
      JLabel logo=new JLabel("ALEX-MIND"); logo.setFont(new Font("SansSerif",Font.BOLD,32)); logo.setForeground(new Color(77,163,255));
      JLabel sub=new JLabel("Secure AI Control"); sub.setForeground(Color.LIGHT_GRAY);
      status.setFont(new Font("SansSerif",Font.BOLD,24)); status.setAlignmentX(Component.LEFT_ALIGNMENT);
      detail.setForeground(Color.LIGHT_GRAY);
      JButton b=new JButton("CHECK NOW"); b.setAlignmentX(Component.LEFT_ALIGNMENT); b.addActionListener(e->check());
      JLabel ep=new JLabel("<html>Backend<br>"+API+"</html>"); ep.setForeground(Color.GRAY);
      p.add(logo);p.add(Box.createVerticalStrut(5));p.add(sub);p.add(Box.createVerticalStrut(45));p.add(status);p.add(Box.createVerticalStrut(10));p.add(detail);p.add(Box.createVerticalStrut(28));p.add(b);p.add(Box.createVerticalStrut(30));p.add(ep);
      f.setContentPane(p);f.setVisible(true);check();
    });
  }
}