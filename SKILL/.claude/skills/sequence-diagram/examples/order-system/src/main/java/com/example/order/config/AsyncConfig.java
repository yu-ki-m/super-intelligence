package com.example.order.config;

import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
@EnableAsync
public class AsyncConfig {

    /** 注文登録中の並列処理（与信照会・見積計算）用。 */
    @Bean
    public Executor orderExecutor() {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setCorePoolSize(8);
        ex.setThreadNamePrefix("order-");
        ex.initialize();
        return ex;
    }

    /** コミット後通知（メール・Kafka）用。 */
    @Bean
    public Executor notificationExecutor() {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setCorePoolSize(4);
        ex.setThreadNamePrefix("notify-");
        ex.initialize();
        return ex;
    }
}
