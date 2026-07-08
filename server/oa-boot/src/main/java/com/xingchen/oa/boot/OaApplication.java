package com.xingchen.oa.boot;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication(scanBasePackages = "com.xingchen.oa")
@EnableJpaRepositories(basePackages = "com.xingchen.oa")
@EntityScan(basePackages = "com.xingchen.oa")
@ConfigurationPropertiesScan(basePackages = "com.xingchen.oa")
public class OaApplication {

    public static void main(String[] args) {
        SpringApplication.run(OaApplication.class, args);
    }
}
